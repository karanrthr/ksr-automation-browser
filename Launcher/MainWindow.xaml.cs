using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Microsoft.Win32;
using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Forms = System.Windows.Forms;
using OpenFileDialog = Microsoft.Win32.OpenFileDialog;
using MessageBox = System.Windows.MessageBox;

namespace KsrAutomationBrowser;
public partial class MainWindow : Window
{
    readonly string root = AppContext.BaseDirectory; readonly JsonSerializerOptions json = new() { WriteIndented = true };
    string Config(string name) => Path.Combine(root, "Config", name);
    JsonObject Profiles => JsonNode.Parse(File.ReadAllText(Config("profiles.json")))!.AsObject();
    JsonObject Extensions => JsonNode.Parse(File.ReadAllText(Config("extensions.json")))!.AsObject();
    JsonObject Active => Profiles["profiles"]!.AsArray().Select(x => x!.AsObject()).First(x => x["isDefault"]?.GetValue<bool>() == true);
    public MainWindow() { InitializeComponent(); Directory.SetCurrentDirectory(root); Refresh(); }
    void Refresh()
    {
        var p = Active; ProfileText.Text = p["name"]!.GetValue<string>(); DownloadText.Text = p["downloadPath"]!.GetValue<string>();
        var browser = BrowserExe(); BrowserText.Text = File.Exists(browser) ? "Chromium runtime ready" : "Runtime unavailable";
        LaunchText.Text = File.Exists(browser) ? FileVersionInfo.GetVersionInfo(browser).ProductVersion ?? "Version unknown" : "Run Repair Browser";
        HostText.Text = File.Exists(Path.Combine(root,"NativeHost","KSR Automation Native Host.exe")) ? "Native host ready" : "Native host not built";
        ExtensionText.Text = $"{Extensions["extensions"]!.AsArray().Count(x => x!["enabled"]?.GetValue<bool>() == true)} enabled extension(s)";
        StatusText.Text = "Ready. Browser profiles remain separate from your normal Chrome profile.";
    }
    string BrowserExe() => Path.Combine(root,"Browser","Chromium","chrome.exe");
    void OpenBrowser(string? url = null)
    {
        try { ApplyDownload(); var exe=BrowserExe(); if (!File.Exists(exe)) throw new FileNotFoundException("Chromium was not found. Use Repair Browser to restore it.");
            var paths = Extensions["extensions"]!.AsArray().Where(x=>x!["enabled"]?.GetValue<bool>() == true).Select(x=>Path.GetFullPath(Path.Combine(root,x!["path"]!.GetValue<string>()))).Where(Directory.Exists);
            var args=$"--user-data-dir=\"{Path.GetFullPath(Path.Combine(root,Active["folder"]!.GetValue<string>()))}\" --load-extension=\"{string.Join(",",paths)}\"" + (url is null ? "" : $" \"{url}\"");
            Process.Start(new ProcessStartInfo(exe,args){UseShellExecute=true}); Log("launcher", "Chromium started."); StatusText.Text="Chromium launched.";
        } catch(Exception ex) { Fail(ex.Message); }
    }
    void ApplyDownload()
    {
        var p=Active; var profile=Path.GetFullPath(Path.Combine(root,p["folder"]!.GetValue<string>())); Directory.CreateDirectory(profile); var pref=Path.Combine(profile,"Default","Preferences"); Directory.CreateDirectory(Path.GetDirectoryName(pref)!);
        var download=Path.GetFullPath(Path.Combine(root,p["downloadPath"]!.GetValue<string>())); Directory.CreateDirectory(download);
        JsonObject obj=File.Exists(pref)?JsonNode.Parse(File.ReadAllText(pref))?.AsObject()??new():new(); obj["download"] ??= new JsonObject(); var d=obj["download"]!.AsObject(); d["default_directory"]=download; d["prompt_for_download"]=p["promptForDownload"]!.GetValue<bool>(); d["directory_upgrade"]=true;
        Atomic(pref,obj.ToJsonString(json));
    }
    void Atomic(string file,string content) { var tmp=file+".tmp"; if(File.Exists(file)) File.Copy(file,file+".bak",true); File.WriteAllText(tmp,content); File.Move(tmp,file,true); }
    void Log(string area,string msg) { Directory.CreateDirectory(Path.Combine(root,"Logs")); File.AppendAllText(Path.Combine(root,"Logs",$"{area}-{DateTime.Today:yyyy-MM-dd}.log"),$"{DateTime.Now:O} {msg}{Environment.NewLine}"); }
    void Fail(string m){Log("launcher","ERROR: "+m); MessageBox.Show(m,"KSR Automation Browser",MessageBoxButton.OK,MessageBoxImage.Error);}
    void OpenBrowser_Click(object s,RoutedEventArgs e)=>OpenBrowser(); void OpenGemini_Click(object s,RoutedEventArgs e)=>OpenBrowser("https://gemini.google.com/"); void OpenChatGpt_Click(object s,RoutedEventArgs e)=>OpenBrowser("https://chatgpt.com/");
    void SelectDownload_Click(object s,RoutedEventArgs e){using var d=new Forms.FolderBrowserDialog{Description="Select this profile's download folder",UseDescriptionForTitle=true}; if(d.ShowDialog()==Forms.DialogResult.OK){Active["downloadPath"]=d.SelectedPath; Atomic(Config("profiles.json"),Profiles.ToJsonString(json)); Refresh();}}
    void OpenDownloads_Click(object s,RoutedEventArgs e){var p=Active["downloadPath"]!.GetValue<string>(); Directory.CreateDirectory(Path.GetFullPath(Path.Combine(root,p))); Process.Start(new ProcessStartInfo(Path.GetFullPath(Path.Combine(root,p))){UseShellExecute=true});}
    void InstallZip_Click(object s,RoutedEventArgs e){var d=new OpenFileDialog{Filter="Extension ZIP (*.zip)|*.zip"};if(d.ShowDialog()==true)try{using var z=ZipFile.OpenRead(d.FileName);var manifest=z.Entries.Where(x=>x.FullName.EndsWith("manifest.json",StringComparison.OrdinalIgnoreCase)).ToList();if(manifest.Count!=1)throw new InvalidDataException("The ZIP must contain exactly one extension manifest.");using var r=new StreamReader(manifest[0].Open());var m=JsonNode.Parse(r.ReadToEnd())!.AsObject();InstallZip(d.FileName,m["name"]?.GetValue<string>()??"Extension",m["version"]?.GetValue<string>()??"0");}catch(Exception ex){Fail("Extension ZIP was not installed: "+ex.Message);}}
    void InstallZip(string file,string name,string version){var safe=string.Concat(name.Select(c=>Path.GetInvalidFileNameChars().Contains(c)?'_':c));var dest=Path.Combine(root,"Extensions","Installed",safe,version);if(Directory.Exists(dest))Directory.Delete(dest,true);Directory.CreateDirectory(dest);using var z=ZipFile.OpenRead(file);foreach(var x in z.Entries){if(string.IsNullOrEmpty(x.Name))continue;var relative=x.FullName.Replace('/','\\');if(relative.Split('\\').Any(p=>p==".."))throw new InvalidDataException("Unsafe ZIP path.");var outp=Path.GetFullPath(Path.Combine(dest,relative));if(!outp.StartsWith(Path.GetFullPath(dest),StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Unsafe ZIP path.");Directory.CreateDirectory(Path.GetDirectoryName(outp)!);x.ExtractToFile(outp,true);} RegisterExtension(name,Path.GetRelativePath(root,dest),version,"managed");}
    void InstallUnpacked_Click(object s,RoutedEventArgs e){using var d=new Forms.FolderBrowserDialog{Description="Choose an extension folder containing manifest.json"};if(d.ShowDialog()==Forms.DialogResult.OK){var mf=Path.Combine(d.SelectedPath,"manifest.json");if(!File.Exists(mf)){Fail("manifest.json was not found.");return;}var m=JsonNode.Parse(File.ReadAllText(mf))!.AsObject();RegisterExtension(m["name"]?.GetValue<string>()??"Extension",d.SelectedPath,m["version"]?.GetValue<string>()??"0","development-link");}}
    void RegisterExtension(string name,string path,string version,string type){var list=Extensions["extensions"]!.AsArray();list.Add(new JsonObject{{"name",name},{"path",path},{"enabled",true},{"installType",type},{"version",version}});Atomic(Config("extensions.json"),Extensions.ToJsonString(json));Log("extensions",$"Installed {name}.");Refresh();MessageBox.Show($"{name} installed. Restart Chromium to load it.","Extension installed");}
    void ManageExtensions_Click(object s,RoutedEventArgs e){var text=string.Join("\n",Extensions["extensions"]!.AsArray().Select(x=>$"{x!["name"]} {x["version"]} - {(x["enabled"]?.GetValue<bool>()==true?"Enabled":"Disabled")}\n{x["path"]}"));MessageBox.Show(text,"Installed Extensions");}
    void ExtensionsPage_Click(object s,RoutedEventArgs e)=>OpenBrowser("chrome://extensions/");
    void CreateProfile_Click(object s,RoutedEventArgs e){var name=Microsoft.VisualBasic.Interaction.InputBox("Profile name:","Create Profile","New Profile").Trim();if(string.IsNullOrWhiteSpace(name))return;var arr=Profiles["profiles"]!.AsArray();if(arr.Any(x=>string.Equals(x!["name"]!.GetValue<string>(),name,StringComparison.OrdinalIgnoreCase))){Fail("That profile already exists.");return;}arr.Add(new JsonObject{{"name",name},{"folder",$"Profiles/{name}"},{"downloadPath","Downloads"},{"promptForDownload",false},{"isDefault",false}});Atomic(Config("profiles.json"),Profiles.ToJsonString(json));Refresh();}
    void ManageProfiles_Click(object s,RoutedEventArgs e){var names=string.Join("\n",Profiles["profiles"]!.AsArray().Select(x=>x!["name"]!.GetValue<string>()));MessageBox.Show("Profiles:\n"+names+"\n\nTo switch, set isDefault in Config/profiles.json while Chromium is closed.","Profile Manager");}
    void OpenLogs_Click(object s,RoutedEventArgs e){Directory.CreateDirectory(Path.Combine(root,"Logs"));Process.Start(new ProcessStartInfo(Path.Combine(root,"Logs")){UseShellExecute=true});}
    void Repair_Click(object s,RoutedEventArgs e){foreach(var p in new[]{"Profiles","Downloads","Logs","Extensions\\Installed","Extensions\\Packages","CrashReports","Updates"})Directory.CreateDirectory(Path.Combine(root,p));Refresh();MessageBox.Show(File.Exists(BrowserExe())?"Repair checks completed. Chromium runtime is present.":"Folders and configuration were repaired. Chromium runtime is still missing; restore Browser/Chromium.","Repair Browser");}
    void Check_Click(object s,RoutedEventArgs e)=>MessageBox.Show($"Chromium: {(File.Exists(BrowserExe())?"Found":"Missing")}\nProfile: {Path.GetFullPath(Path.Combine(root,Active["folder"]!.GetValue<string>()))}\nNative host: {(File.Exists(Path.Combine(root,"NativeHost","KSR Automation Native Host.exe"))?"Found":"Not built")}","Browser file check"); void Exit_Click(object s,RoutedEventArgs e)=>Close();
}
