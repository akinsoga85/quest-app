// Generates packages/contract/src/database.types.ts from the live schema, in
// the shape supabase-js expects. Works on plain Postgres, so it runs locally
// and in CI without Docker. Run after any migration: `npm run gen:types`.
import { writeFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/quest";
const out = new URL("../packages/contract/src/database.types.ts", import.meta.url);
const db = new pg.Client({ connectionString: url });
await db.connect();

const enums = (
  await db.query(`
    select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname`)
).rows;
const enumNames = new Set(enums.map((e) => e.name));

const columns = (
  await db.query(`
    select c.table_name, t.table_type, c.column_name, c.data_type, c.udt_name, c.is_nullable,
           c.column_default, c.is_identity, c.is_generated
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
    order by c.table_name, c.ordinal_position`)
).rows;

const fks = (
  await db.query(`
    select con.conname as name, rel.relname as table_name, frel.relname as ref_table,
           array_agg(att.attname::text order by k.ord) as cols,
           array_agg(fatt.attname::text order by k.ord) as ref_cols,
           exists (
             select 1 from pg_index i
             where i.indrelid = con.conrelid and i.indisunique and i.indpred is null
               and (select array_agg(a order by a) from unnest(i.indkey::int2[]) a)
                 = (select array_agg(a order by a) from unnest(con.conkey) a)
           ) as one_to_one
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class frel on frel.oid = con.confrelid
    join pg_namespace fn on fn.oid = frel.relnamespace
    cross join lateral unnest(con.conkey, con.confkey) with ordinality as k(attnum, fattnum, ord)
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    join pg_attribute fatt on fatt.attrelid = con.confrelid and fatt.attnum = k.fattnum
    where con.contype = 'f' and n.nspname = 'public' and fn.nspname = 'public'
    group by con.conname, rel.relname, frel.relname, con.conrelid, con.conkey
    order by con.conname`)
).rows;
// Functions the app may call with supabase.rpc() (schema public only).
const functions = (
  await db.query(`
    select p.proname as name, p.proretset as returns_set, p.prorettype::int as ret_oid,
           p.pronargs as nargs, p.pronargdefaults as ndefaults,
           coalesce(p.proargnames, '{}')::text[] as arg_names,
           coalesce(p.proargmodes::text[], '{}')::text[] as arg_modes,
           coalesce(p.proallargtypes, p.proargtypes::oid[])::int[] as arg_oids
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by p.proname`)
).rows;
const oids = [...new Set(functions.flatMap((f) => [f.ret_oid, ...f.arg_oids]))];
const typeByOid = new Map(
  (await db.query("select oid::int as oid, typname, typelem::int as elem from pg_type where oid = any($1::oid[])", [oids])).rows.map((t) => [t.oid, t]),
);
const elemNames = new Map(
  (await db.query("select oid::int as oid, typname from pg_type where oid = any($1::oid[])", [[...typeByOid.values()].map((t) => t.elem).filter(Boolean)])).rows.map((t) => [t.oid, t.typname]),
);
await db.end();

const base = (udt) => {
  if (enumNames.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  switch (udt) {
    case "int2": case "int4": case "int8": case "float4": case "float8": case "numeric":
      return "number";
    case "bool":
      return "boolean";
    case "json": case "jsonb":
      return "Json";
    default:
      return "string";
  }
};
const tsType = (c) => (c.data_type === "ARRAY" ? `${base(c.udt_name.slice(1))}[]` : base(c.udt_name));
const oidType = (oid) => {
  const t = typeByOid.get(oid);
  if (!t) return "unknown";
  if (t.elem) return `${base(elemNames.get(t.elem))}[]`;
  return base(t.typname);
};

const functionTypes = functions.map((f) => {
  const modes = f.arg_modes.length ? f.arg_modes : f.arg_oids.map(() => "i");
  const inputs = [];
  const outputs = [];
  modes.forEach((m, i) => {
    const arg = { name: f.arg_names[i] ?? `arg${i}`, type: oidType(f.arg_oids[i]) };
    if (m === "i" || m === "b" || m === "v") inputs.push(arg);
    if (m === "o" || m === "b" || m === "t") outputs.push(arg);
  });
  const firstDefault = f.nargs - f.ndefaults;
  const args = inputs.map((a, i) => `${a.name}${i >= firstDefault ? "?" : ""}: ${a.type}`);
  let returns;
  if (outputs.length) {
    const row = `{ ${outputs.map((o) => `${o.name}: ${o.type}`).join("; ")} }`;
    returns = f.returns_set ? `${row}[]` : row;
  } else {
    const t = typeByOid.get(f.ret_oid)?.typname;
    returns = t === "void" ? "undefined" : f.returns_set ? `${oidType(f.ret_oid)}[]` : oidType(f.ret_oid);
  }
  return { name: f.name, args, returns };
});

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, { type: c.table_type, cols: [] });
  byTable.get(c.table_name).cols.push(c);
}

const ind = (n) => "  ".repeat(n);
const relationships = (table, depth) => {
  const rels = fks.filter((f) => f.table_name === table);
  if (!rels.length) return "[]";
  const items = rels.map(
    (f) =>
      `${ind(depth + 1)}{\n` +
      `${ind(depth + 2)}foreignKeyName: "${f.name}"\n` +
      `${ind(depth + 2)}columns: [${f.cols.map((x) => `"${x}"`).join(", ")}]\n` +
      `${ind(depth + 2)}isOneToOne: ${f.one_to_one}\n` +
      `${ind(depth + 2)}referencedRelation: "${f.ref_table}"\n` +
      `${ind(depth + 2)}referencedColumns: [${f.ref_cols.map((x) => `"${x}"`).join(", ")}]\n` +
      `${ind(depth + 1)}},`,
  );
  return `[\n${items.join("\n")}\n${ind(depth)}]`;
};

const lines = [];
const emitRelation = (name, { cols }, isView) => {
  lines.push(`${ind(3)}${name}: {`);
  lines.push(`${ind(4)}Row: {`);
  for (const c of cols) lines.push(`${ind(5)}${c.column_name}: ${tsType(c)}${c.is_nullable === "YES" ? " | null" : ""}`);
  lines.push(`${ind(4)}}`);
  if (!isView) {
    lines.push(`${ind(4)}Insert: {`);
    for (const c of cols) {
      const optional = c.is_nullable === "YES" || c.column_default !== null || c.is_identity === "YES" || c.is_generated === "ALWAYS";
      lines.push(`${ind(5)}${c.column_name}${optional ? "?" : ""}: ${tsType(c)}${c.is_nullable === "YES" ? " | null" : ""}`);
    }
    lines.push(`${ind(4)}}`);
    lines.push(`${ind(4)}Update: {`);
    for (const c of cols) lines.push(`${ind(5)}${c.column_name}?: ${tsType(c)}${c.is_nullable === "YES" ? " | null" : ""}`);
    lines.push(`${ind(4)}}`);
  }
  lines.push(`${ind(4)}Relationships: ${relationships(name, 4)}`);
  lines.push(`${ind(3)}}`);
};

lines.push("// Generated by scripts/gen-db-types.mjs from the migrations. Do not edit by hand.");
lines.push("");
lines.push("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]");
lines.push("");
lines.push("export type Database = {");
lines.push(`${ind(1)}public: {`);
lines.push(`${ind(2)}Tables: {`);
for (const [name, t] of byTable) if (t.type === "BASE TABLE") emitRelation(name, t, false);
lines.push(`${ind(2)}}`);
lines.push(`${ind(2)}Views: {`);
for (const [name, t] of byTable) if (t.type === "VIEW") emitRelation(name, t, true);
lines.push(`${ind(2)}}`);
if (functionTypes.length) {
  lines.push(`${ind(2)}Functions: {`);
  for (const f of functionTypes) {
    lines.push(`${ind(3)}${f.name}: {`);
    lines.push(`${ind(4)}Args: ${f.args.length ? `{ ${f.args.join("; ")} }` : "Record<PropertyKey, never>"}`);
    lines.push(`${ind(4)}Returns: ${f.returns}`);
    lines.push(`${ind(3)}}`);
  }
  lines.push(`${ind(2)}}`);
} else {
  lines.push(`${ind(2)}Functions: { [_ in never]: never }`);
}
lines.push(`${ind(2)}Enums: {`);
for (const e of enums) lines.push(`${ind(3)}${e.name}: ${e.labels.map((l) => `"${l}"`).join(" | ")}`);
lines.push(`${ind(2)}}`);
lines.push(`${ind(2)}CompositeTypes: { [_ in never]: never }`);
lines.push(`${ind(1)}}`);
lines.push("}");
lines.push("");

writeFileSync(out, lines.join("\n"));
console.log(`wrote ${out.pathname} (${byTable.size} tables and views, ${enums.length} enums)`);
