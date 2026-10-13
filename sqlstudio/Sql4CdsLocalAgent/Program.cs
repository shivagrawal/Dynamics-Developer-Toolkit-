using System.Text.Json;
using MarkMpn.Sql4Cds.Engine;
using Microsoft.AspNetCore.Http.Json;

var builder = WebApplication.CreateBuilder(args);

// Bind only to loopback. Never change to 0.0.0.0 or a LAN IP.
builder.WebHost.UseUrls("http://127.0.0.1:32146");
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);

var app = builder.Build();

// CORS alone is not authentication. Production pairing must use an install-generated
// secret, validate it in constant time, and never place it in the URL.
app.Use(async (context, next) =>
{
    var origin = context.Request.Headers.Origin.ToString();
    if (!string.IsNullOrEmpty(origin) &&
        !origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) &&
        !origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase) &&
        !origin.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new { error = "Origin not allowed." });
        return;
    }

    await next();
});

app.MapGet("/health", () => Results.Ok(new
{
    ok = true,
    service = "DevLens SQL4CDS Local Agent",
    version = "0.1.0",
    engine = "MarkMpn.Sql4Cds.Engine",
    authenticated = false,
    mode = "read-only"
}));

app.MapPost("/api/query", (QueryRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Sql))
        return Results.BadRequest(new { error = "Enter a SQL query." });
    if (request.Sql.Length > 100_000)
        return Results.BadRequest(new { error = "Query exceeds the 100,000 character limit." });

    var validation = ReadOnlySqlGuard.Validate(request.Sql);
    if (!validation.Ok)
        return Results.BadRequest(new { error = validation.Error, code = "READ_ONLY_ONLY" });

    // Execution intentionally stays disabled until we implement and validate a supported
    // Dataverse SDK authentication flow. Do not silently use admin or stored credentials.
    return Results.Json(new
    {
        error = "Authentication provider is not configured. No query was executed.",
        code = "AUTH_PROVIDER_REQUIRED",
        mode = "read-only"
    }, statusCode: StatusCodes.Status501NotImplemented);
});

app.Run();

record QueryRequest(string Sql, string? EnvironmentUrl, int? MaxRows);
