using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Backend.Models;

namespace Backend.Services;

public sealed class DataStoreService(string filePath)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<string> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return await File.ReadAllTextAsync(filePath, cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<DataUpdateResult> SaveAsync(string raw, CancellationToken cancellationToken)
    {
        var data = JsonNode.Parse(raw) as JsonObject
            ?? throw new JsonException("Expected a JSON object.");

        if (data["meta"] is not JsonObject meta)
        {
            meta = new JsonObject();
            data["meta"] = meta;
        }

        var updatedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        meta["updatedAt"] = updatedAt;
        if (meta["createdAt"] == null || string.IsNullOrEmpty(meta["createdAt"]?.ToString()))
        {
            meta["createdAt"] = updatedAt;
        }

        var formatted = data.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var temporaryFile = filePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllTextAsync(temporaryFile, formatted, new UTF8Encoding(false), cancellationToken);
                File.Move(temporaryFile, filePath, true);
            }
            finally
            {
                if (File.Exists(temporaryFile)) File.Delete(temporaryFile);
            }
        }
        finally
        {
            _gate.Release();
        }

        return new DataUpdateResult(true, updatedAt);
    }
}
