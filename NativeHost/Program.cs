using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

// Native Messaging protocol: length-prefixed UTF-8 JSON only on stdout.
var root = Environment.GetEnvironmentVariable("KSR_BROWSER_ROOT") ?? AppContext.BaseDirectory;
var config = Path.Combine(root, "Config", "profiles.json");
Directory.CreateDirectory(Path.Combine(root, "Logs"));
while (true) {
    try { var input = ReadMessage(); if (input is null) break; var command=input["command"]?.GetValue<string>()??""; Write(Handle(command,input)); }
    catch(Exception ex) { Log("ERROR "+ex); Write(new JsonObject{{"success",false},{"error",ex.Message}}); }
}
JsonObject Handle(string c, JsonObject a) {
    string profilePath=DownloadPath(); string path=a["path"]?.GetValue<string>()??"";
    switch(c) {
        case "ping": return Ok(c,new JsonObject{{"host","KSR Automation Native Host"},{"version","1.0.0"}});
        case "getAppVersion": return Ok(c,new JsonObject{{"version","1.0.0"}});
        case "getActiveProfile": return Ok(c,new JsonObject{{"profile",Active()["name"]!.GetValue<string>()}});
        case "getDownloadPath": return Ok(c,new JsonObject{{"path",profilePath}});
        case "getDiskSpace": { var d=new DriveInfo(Path.GetPathRoot(Path.GetFullPath(path==""?profilePath:path))!); return Ok(c,new JsonObject{{"freeBytes",d.AvailableFreeSpace},{"totalBytes",d.TotalSize}}); }
        case "fileExists": return Ok(c,new JsonObject{{"exists",File.Exists(path)}});
        case "getFileSize": return Ok(c,new JsonObject{{"size",File.Exists(path)?new FileInfo(path).Length:-1}});
        case "getFileHash": return Ok(c,new JsonObject{{"sha256",Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant()}});
        case "createFolder": Directory.CreateDirectory(path); return Ok(c);
        case "listFiles": return Ok(c,new JsonObject{{"files",new JsonArray(Directory.Exists(path)?Directory.GetFiles(path).Select(f=>(JsonNode?)JsonValue.Create(f)).ToArray():Array.Empty<JsonNode?>())}});
        case "moveFile": File.Move(path,a["destination"]!.GetValue<string>(),true); return Ok(c);
        case "copyFile": File.Copy(path,a["destination"]!.GetValue<string>(),true); return Ok(c);
        case "renameFile": File.Move(path,Path.Combine(Path.GetDirectoryName(path)!,a["name"]!.GetValue<string>()),true); return Ok(c);
        case "openFolder": System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path){UseShellExecute=true}); return Ok(c);
        case "writeLog": Log(a["message"]?.GetValue<string>()??""); return Ok(c);
        case "validateImage": return ValidateImage(c,path);
        default: return new JsonObject{{"success",false},{"command",c},{"error","Unsupported command"}};
    }
}
JsonObject Active()=>JsonNode.Parse(File.ReadAllText(config))!["profiles"]!.AsArray().Select(x=>x!.AsObject()).First(x=>x["isDefault"]?.GetValue<bool>()==true);
string DownloadPath()=>Path.GetFullPath(Path.Combine(root,Active()["downloadPath"]!.GetValue<string>()));
JsonObject ValidateImage(string c,string p){if(!File.Exists(p)||new FileInfo(p).Length==0)return new JsonObject{{"success",false},{"command",c},{"error","Missing or empty file"}};var b=File.ReadAllBytes(p).Take(12).ToArray();bool ok=b.Length>=8&&((b[0]==137&&b[1]==80&&b[2]==78&&b[3]==71)||(b[0]==255&&b[1]==216)||(b[0]==82&&b[1]==73&&b[2]==70&&b[3]==70)||(b[0]==71&&b[1]==73&&b[2]==70));return new JsonObject{{"success",ok},{"command",c},{"valid",ok}};}
JsonObject Ok(string c,JsonObject? extra=null){var r=extra??new JsonObject();r["success"]=true;r["command"]=c;return r;}
JsonObject? ReadMessage(){var lenBytes=Console.OpenStandardInput();var size=new byte[4];if(lenBytes.Read(size,0,4)!=4)return null;var len=BitConverter.ToInt32(size,0);if(len<1||len>10_000_000)throw new InvalidDataException("Invalid message length");var b=new byte[len];var read=0;while(read<len){var n=lenBytes.Read(b,read,len-read);if(n==0)throw new EndOfStreamException();read+=n;}return JsonNode.Parse(Encoding.UTF8.GetString(b))!.AsObject();}
void Write(JsonObject o){var b=Encoding.UTF8.GetBytes(o.ToJsonString());var stdout=Console.OpenStandardOutput();stdout.Write(BitConverter.GetBytes(b.Length));stdout.Write(b);stdout.Flush();}
void Log(string m)=>File.AppendAllText(Path.Combine(root,"Logs",$"native-host-{DateTime.Today:yyyy-MM-dd}.log"),$"{DateTime.Now:O} {m}{Environment.NewLine}");
