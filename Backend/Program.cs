using Backend.Services;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:5000");
builder.Services.AddControllers();

var directory = new DirectoryInfo(AppContext.BaseDirectory);
while (directory != null &&
       (!File.Exists(Path.Combine(directory.FullName, "index.html")) ||
        !File.Exists(Path.Combine(directory.FullName, "Backend", "Backend.csproj"))))
{
    directory = directory.Parent;
}

if (directory == null)
{
    throw new InvalidOperationException("Khong tim thay thu muc du an.");
}

var projectRoot = directory.FullName;
var dataFile = Environment.GetEnvironmentVariable("FOCUS_DATA_FILE");
builder.Services.AddSingleton(new DataStoreService(
    string.IsNullOrWhiteSpace(dataFile)
        ? Path.Combine(projectRoot, "backend-data.json")
        : Path.GetFullPath(dataFile)));

var app = builder.Build();

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
        if (!context.Request.Path.Equals("/api/data", StringComparison.Ordinal))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            await context.Response.WriteAsJsonAsync(new { error = "API khong ton tai" });
            return;
        }

        if (context.Request.Method is not ("GET" or "PUT"))
        {
            context.Response.StatusCode = StatusCodes.Status405MethodNotAllowed;
            await context.Response.WriteAsJsonAsync(new { error = "Method khong duoc ho tro" });
            return;
        }
    }

    await next();
});

app.MapControllers();

foreach (var (route, fileName, contentType) in new[]
{
    ("/", "index.html", "text/html; charset=utf-8"),
    ("/index.html", "index.html", "text/html; charset=utf-8"),
    ("/csc.css", "csc.css", "text/css; charset=utf-8"),
    ("/js.js", "js.js", "text/javascript; charset=utf-8")
})
{
    var filePath = Path.Combine(projectRoot, fileName);
    app.MapGet(route, () => Results.File(filePath, contentType));
}

app.Run();
