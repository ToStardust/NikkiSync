using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NikkiSync.WindowsShell.Services;

public sealed record SupportError(string Code,int Count);
public sealed record SupportDiagnosticReport(int Schema,string Platform,string Version,long Build,int OsBuild,SupportError[] Errors);

public static class SupportGatewayClient
{
    private static readonly HttpClient Http=new(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false});
    private static readonly Regex ReceiptPattern=new(@"\ANS1\.([1-9][0-9]{0,11})\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\z",RegexOptions.CultureInvariant);
    public static readonly JsonSerializerOptions JsonOptions=new(JsonSerializerDefaults.Web){WriteIndented=true};

    public static Uri? ConfiguredEndpoint()
    {
        var configured=Environment.GetEnvironmentVariable("MOMO_SUPPORT_URL") ??
            typeof(SupportGatewayClient).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>()
                .FirstOrDefault(attribute=>attribute.Key=="MomoSupportUrl")?.Value;
        if(!Uri.TryCreate(configured?.TrimEnd('/')+"/v1/reports",UriKind.Absolute,out var endpoint)
            ||endpoint.Scheme!=Uri.UriSchemeHttps||endpoint.Host.Length==0||endpoint.UserInfo.Length!=0
            ||endpoint.Query.Length!=0||endpoint.Fragment.Length!=0)return null;
        return endpoint;
    }

    public static async Task<(string Issue,string Receipt)> SubmitAsync(Uri endpoint,SupportDiagnosticReport report,CancellationToken cancellationToken)
    {
        if(endpoint.Scheme!=Uri.UriSchemeHttps||endpoint.UserInfo.Length!=0)throw new IOException("Feedback HTTPS endpoint required.");
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(35));
        using var request=new HttpRequestMessage(HttpMethod.Post,endpoint){Content=JsonContent.Create(report,options:JsonOptions)};
        using var response=await Http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token).ConfigureAwait(false);
        if(response.StatusCode!=HttpStatusCode.Created)throw new IOException("Feedback submission unavailable.");
        await using var input=await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
        using var body=new MemoryStream();
        var buffer=new byte[1024];
        for(int count;(count=await input.ReadAsync(buffer,timeout.Token).ConfigureAwait(false))>0;)
        {
            if(body.Length+count>4096)throw new IOException("Feedback reply too large.");
            body.Write(buffer,0,count);
        }
        using var document=JsonDocument.Parse(body.ToArray());
        var value=document.RootElement;
        if(value.ValueKind!=JsonValueKind.Object||!value.TryGetProperty("issue",out var issue)||issue.ValueKind!=JsonValueKind.String
            ||!value.TryGetProperty("receipt",out var receipt)||receipt.ValueKind!=JsonValueKind.String)
            throw new IOException("Invalid feedback receipt.");
        var code=receipt.GetString()!;
        var match=ReceiptPattern.Match(code);
        if(!match.Success||match.Groups[1].Value!=issue.GetString())throw new IOException("Invalid feedback receipt.");
        return (match.Groups[1].Value,code);
    }
}
