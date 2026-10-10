import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");

// SQL4CDS exposes several security/metadata views that are not ordinary
// Dataverse EntityDefinitions. This fixture models their SQL-visible schema
// so parser/compiler behavior can be tested offline without production data.
const entity = (logicalName, columns, primaryIdAttribute = columns[0]) => ({
  logicalName,
  entitySetName: logicalName + "s",
  primaryIdAttribute,
  columns: columns.map(column => ({
    logicalName: column,
    queryable: true,
    attributeType: ["fullname", "name", "logicalname"].includes(column.toLowerCase()) ? "String" : "Uniqueidentifier"
  }))
});

const metadata = {
  entities: {
    systemuserroles: entity("systemuserroles", ["systemuserid", "roleid"], "systemuserid"),
    systemuser: entity("systemuser", ["systemuserid", "fullname"]),
    role: entity("role", ["roleid", "name", "businessunitid", "parentrootroleid"]),
    businessunit: entity("businessunit", ["businessunitid", "name"]),
    privilege: entity("privilege", ["privilegeid", "name"]),
    privilegeobjecttypecodes: entity("privilegeobjecttypecodes", ["privilegeid", "objecttypecode"]),
    entity: entity("entity", ["objecttypecode", "logicalname"])
  }
};

const userRolesQuery = `
-- Gets all the role of the user along with role's BU
SELECT
    SU.fullname,
    SU.systemuserid,
    R.name AS role_name,
    BU.name AS role_businessunit
FROM SystemUserRoles AS SUR
INNER JOIN SystemUser AS SU ON SUR.systemuserid = SU.systemuserid
INNER JOIN Role AS R ON SUR.roleid = R.roleid
INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid
WHERE SU.fullname LIKE '%USD8%'
`;

const privilegeNamesQuery = `
SELECT DISTINCT
    p.name AS privilege_name
FROM privilege p
INNER JOIN privilegeobjecttypecodes potc
    ON potc.privilegeid = p.privilegeid
INNER JOIN entity e
    ON e.objecttypecode = potc.objecttypecode
WHERE e.logicalname = 'salesorder'
ORDER BY p.name
`;

test("security query 1: user roles, role business unit, aliases and LIKE", () => {
  const result = engine.compileSql(userRolesQuery, metadata);
  assert.equal(result.readOnly, true);
  assert.match(result.fetchXml, /<entity name="systemuserroles">/);
  assert.match(result.fetchXml, /<link-entity name="systemuser" alias="SU"/);
  assert.match(result.fetchXml, /<link-entity name="role" alias="R"/);
  assert.match(result.fetchXml, /<link-entity name="businessunit" alias="BU"/);
  assert.match(result.fetchXml, /operator="like"/);
  assert.deepEqual(result.resultColumns.map(column => column.label), [
    "su.fullname", "su.systemuserid", "role_name", "role_businessunit"
  ]);
});

test("security query 2: distinct privilege names by entity and ORDER BY", () => {
  const result = engine.compileSql(privilegeNamesQuery, metadata);
  assert.equal(result.readOnly, true);
  assert.match(result.fetchXml, /<fetch distinct="true">/);
  assert.match(result.fetchXml, /<entity name="privilege">/);
  assert.match(result.fetchXml, /<link-entity name="privilegeobjecttypecodes" alias="potc"/);
  assert.match(result.fetchXml, /<link-entity name="entity" alias="e"/);
  assert.match(result.fetchXml, /attribute="logicalname" operator="eq" entityname="e"><value>salesorder<\/value>/);
  assert.ok(result.fetchXml.includes('<order attribute="name"'));
  assert.deepEqual(result.resultColumns.map(column => column.label), ["privilege_name"]);
});

// These TODOs are deliberate: the current compiler must not be represented as
// supporting syntax it cannot yet execute. Promote each to an executable
// fixture test only when its parser, planner and execution semantics are ready.
test.todo("security query 3: CASE expressions, role root inheritance and role privileges");
test.todo("security query 4: role privilege lookup and CASE depth mapping");
test.todo("security query 5: ISNULL, MAX(CASE...), CASE projections and GROUP BY");
test.todo("security query 6: audit changedata JSON expansion (OPENJSON/CROSS APPLY) and CASE");
