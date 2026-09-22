using System.Text.Json;
using Backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace Backend.Controllers;

[ApiController]
[Route("api/data")]
public sealed class DataController(DataStoreService store) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        try
        {
            return Content(await store.ReadAsync(cancellationToken), "application/json; charset=utf-8");
        }
        catch (IOException)
        {
            return StatusCode(500, new { error = "Khong doc duoc backend-data.json" });
        }
        catch (UnauthorizedAccessException)
        {
            return StatusCode(500, new { error = "Khong doc duoc backend-data.json" });
        }
    }

    [HttpPut]
    public async Task<IActionResult> Put(CancellationToken cancellationToken)
    {
        try
        {
            using var reader = new StreamReader(Request.Body);
            var raw = await reader.ReadToEndAsync(cancellationToken);
            var result = await store.SaveAsync(raw, cancellationToken);
            return Ok(new { ok = result.Ok, updatedAt = result.UpdatedAt });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "Du lieu gui len khong hop le" });
        }
        catch (IOException)
        {
            return BadRequest(new { error = "Du lieu gui len khong hop le" });
        }
        catch (UnauthorizedAccessException)
        {
            return BadRequest(new { error = "Du lieu gui len khong hop le" });
        }
    }
}
