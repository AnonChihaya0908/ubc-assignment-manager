using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;
using System.Windows.Forms;

[assembly: AssemblyTitle("UBC作业管理工具安装程序")]
[assembly: AssemblyProduct("UBC作业管理工具")]

internal static class Program
{
    private const string Product = "UBC作业管理工具";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\UBCAssignmentManager";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "/verify") return VerifyPackage();
        Application.EnableVisualStyles();
        string installDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", Product);
        bool oldMoved = false;
        bool installStarted = false;
        DialogResult answer = MessageBox.Show(
            "将为当前 Windows 账户安装 UBC作业管理工具。\n\n安装位置：\n" + installDirectory +
            "\n\n安装后会创建开始菜单和桌面入口。课程、登录资料和提醒设置保存在独立的用户数据目录中。",
            Product + " 安装程序", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
        if (answer != DialogResult.OK) return 1;

        string stage = Path.Combine(Path.GetTempPath(), "ubc-assignment-install-" + Guid.NewGuid().ToString("N"));
        string backup = Path.Combine(Path.GetTempPath(), "ubc-assignment-backup-" + Guid.NewGuid().ToString("N"));
        try
        {
            string source = ExtractPayload(stage);
            ValidatePayload(source);
            string version = ReadVersion(Path.Combine(source, "package.json"));

            MigratePortableData();
            StopRunningApp();
            if (Directory.Exists(installDirectory)) { Directory.Move(installDirectory, backup); oldMoved = true; }
            installStarted = true;
            CopyDirectory(source, installDirectory);
            RegisterInstallation(installDirectory, version);
            CreateShortcuts(installDirectory);

            Process.Start(new ProcessStartInfo(Path.Combine(installDirectory, Product + ".exe")) { WorkingDirectory = installDirectory });
            if (!WaitForHealthy(version)) throw new InvalidOperationException("新版应用未能启动，安装已自动恢复。");
            if (Directory.Exists(backup)) Directory.Delete(backup, true);
            MessageBox.Show("安装完成。UBC作业管理工具已经启动。", Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            try
            {
                StopRunningApp();
                if (installStarted && Directory.Exists(installDirectory)) Directory.Delete(installDirectory, true);
                if (oldMoved && Directory.Exists(backup))
                {
                    Directory.Move(backup, installDirectory);
                    RegisterInstallation(installDirectory, ReadVersion(Path.Combine(installDirectory, "package.json")));
                    CreateShortcuts(installDirectory);
                }
                else if (installStarted)
                {
                    Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
                    RemoveShortcuts();
                }
                if (File.Exists(Path.Combine(installDirectory, Product + ".exe")))
                    Process.Start(new ProcessStartInfo(Path.Combine(installDirectory, Product + ".exe")) { WorkingDirectory = installDirectory });
            }
            catch { }
            MessageBox.Show("安装失败：" + error.Message, Product + " 安装程序", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(stage)) Directory.Delete(stage, true); } catch { }
        }
    }

    private static int VerifyPackage()
    {
        string stage = Path.Combine(Path.GetTempPath(), "ubc-assignment-verify-" + Guid.NewGuid().ToString("N"));
        try
        {
            string source = ExtractPayload(stage);
            ValidatePayload(source);
            ReadVersion(Path.Combine(source, "package.json"));
            return 0;
        }
        catch { return 1; }
        finally { try { if (Directory.Exists(stage)) Directory.Delete(stage, true); } catch { } }
    }

    private static string ExtractPayload(string stage)
    {
        Directory.CreateDirectory(stage);
        string archive = Path.Combine(stage, "payload.zip");
        using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (resource == null) throw new InvalidOperationException("安装包缺少应用文件。");
            using (FileStream output = File.Create(archive)) resource.CopyTo(output);
        }
        ZipFile.ExtractToDirectory(archive, stage);
        return Path.Combine(stage, Product);
    }

    private static void ValidatePayload(string source)
    {
        string[] required = { Product + ".exe", "app.js", "package.json", "runtime", "lib", "public", "卸载 UBC作业管理工具.exe" };
        foreach (string name in required)
            if (!File.Exists(Path.Combine(source, name)) && !Directory.Exists(Path.Combine(source, name)))
                throw new InvalidOperationException("安装包缺少 " + name + "。");
        if (Directory.Exists(Path.Combine(source, ".local-data")))
            throw new InvalidOperationException("安装包包含不应发布的个人数据。");
    }

    private static string ReadVersion(string manifest)
    {
        Match match = Regex.Match(File.ReadAllText(manifest, Encoding.UTF8), "\\\"version\\\"\\s*:\\s*\\\"(\\d+\\.\\d+\\.\\d+)\\\"");
        if (!match.Success) throw new InvalidOperationException("无法读取应用版本。");
        return match.Groups[1].Value;
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(directory.Replace(source, destination));
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            File.Copy(file, file.Replace(source, destination), true);
    }

    private static void CopyMissing(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(directory.Replace(source, destination));
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string target = file.Replace(source, destination);
            if (!File.Exists(target)) File.Copy(file, target);
        }
    }

    private static void MigratePortableData()
    {
        string installerDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string startupDirectory = null;
        using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
        {
            string command = run == null ? null : run.GetValue("UBCAssignmentManager") as string;
            if (!String.IsNullOrWhiteSpace(command))
            {
                Match executable = Regex.Match(command, "^\\s*\\\"([^\\\"]+\\.exe)\\\"");
                if (executable.Success) startupDirectory = Path.GetDirectoryName(executable.Groups[1].Value);
            }
        }
        string parent = Directory.GetParent(installerDirectory) == null ? null : Directory.GetParent(installerDirectory).FullName;
        string[] candidates = { installerDirectory, parent, Environment.CurrentDirectory, startupDirectory };
        string destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product, "data");
        foreach (string candidate in candidates)
        {
            if (String.IsNullOrWhiteSpace(candidate)) continue;
            string legacy = Path.Combine(candidate, ".local-data");
            if (Directory.Exists(legacy)) CopyMissing(legacy, destination);
        }
    }

    private static void RegisterInstallation(string directory, string version)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", Product);
            key.SetValue("DisplayVersion", version);
            key.SetValue("Publisher", "AnonChihaya0908");
            key.SetValue("InstallLocation", directory);
            key.SetValue("DisplayIcon", Path.Combine(directory, Product + ".exe"));
            key.SetValue("UninstallString", "\"" + Path.Combine(directory, "卸载 UBC作业管理工具.exe") + "\"");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    private static void CreateShortcuts(string directory)
    {
        string target = Path.Combine(directory, Product + ".exe");
        string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product + ".lnk");
        string menuDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", Product);
        Directory.CreateDirectory(menuDirectory);
        CreateShortcut(target, desktop, directory);
        CreateShortcut(target, Path.Combine(menuDirectory, Product + ".lnk"), directory);
        CreateShortcut(Path.Combine(directory, "卸载 UBC作业管理工具.exe"), Path.Combine(menuDirectory, "卸载 " + Product + ".lnk"), directory);
    }

    private static void RemoveShortcuts()
    {
        string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product + ".lnk");
        if (File.Exists(desktop)) File.Delete(desktop);
        string menuDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", Product);
        if (Directory.Exists(menuDirectory)) Directory.Delete(menuDirectory, true);
    }

    private static void CreateShortcut(string target, string shortcut, string workingDirectory)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(shellType);
        dynamic link = shell.CreateShortcut(shortcut);
        link.TargetPath = target;
        link.WorkingDirectory = workingDirectory;
        link.IconLocation = target + ",0";
        link.Save();
    }

    private static void StopRunningApp()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:43873/api/shutdown");
            request.Method = "POST";
            request.ContentType = "application/json";
            byte[] body = Encoding.UTF8.GetBytes("{}");
            request.ContentLength = body.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(body, 0, body.Length);
            using (WebResponse response = request.GetResponse()) { }
            Thread.Sleep(1500);
        }
        catch { }
    }

    private static bool WaitForHealthy(string version)
    {
        for (int attempt = 0; attempt < 30; attempt++)
        {
            Thread.Sleep(1000);
            try
            {
                using (WebClient client = new WebClient())
                {
                    string state = client.DownloadString("http://127.0.0.1:43873/api/state");
                    if (state.Contains("\"version\":\"" + version + "\"")) return true;
                }
            }
            catch { }
        }
        return false;
    }
}
