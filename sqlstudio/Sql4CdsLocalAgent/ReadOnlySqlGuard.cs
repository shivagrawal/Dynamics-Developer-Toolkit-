using Microsoft.SqlServer.TransactSql.ScriptDom;
using System.IO;
using System.Linq;

static class ReadOnlySqlGuard
{
    public static (bool Ok, string? Error) Validate(string sql)
    {
        var parser = new TSql160Parser(initialQuotedIdentifiers: true);
        var fragment = parser.Parse(new StringReader(sql), out var errors);

        if (errors.Count > 0)
            return (false, $"SQL parse error at line {errors[0].Line}, column {errors[0].Column}: {errors[0].Message}");

        if (fragment is not TSqlScript script || script.Batches.Count == 0)
            return (false, "Expected a SQL statement.");

        var statements = script.Batches.SelectMany(b => b.Statements).ToArray();
        if (statements.Length == 0)
            return (false, "Expected a SELECT statement.");

        foreach (var statement in statements)
        {
            if (statement is not SelectStatement)
                return (false, $"Read-only mode permits SELECT statements only; found {statement.GetType().Name}.");
        }

        return (true, null);
    }
}
