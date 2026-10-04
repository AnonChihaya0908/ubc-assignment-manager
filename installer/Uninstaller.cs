using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using Microsoft.Win32;
using System.Windows.Forms;

[assembly: AssemblyTitle("卸载 UBC作业管理工具")]
[assembly: AssemblyProduct("UBC作业管理工具")]

internal static class Program
{
    private const string Product = "UBC作业管理工具";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\UBCAssignmentManager";
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (args.Length == 4 && args[0] == "/perform") return Perform(args[1], args[2] == "delete", int.Parse(args[3]));
        DialogResult choice = MessageBox.Show(
            "是否同时删除课程、作业、登录资料和提醒设置？\n\n选择“是”删除个人数据；选择“否”保留数据，以便以后重新安装；选择“取消”停止卸载。",
            "卸载 " + Product, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
        if (choice == DialogResult.Cancel) return 1;
        string temporary = Path.Combine(Path.GetTempPath(), "ubc-assignment-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
        File.Copy(Assembly.GetExecutingAssembly().Location, temporary, true);
        Process.Start(new ProcessStartInfo(temporary)
        {
            Arguments = "/perform \"" + AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\') + "\" " + (choice == DialogResult.Yes ? "delete" : "keep") + " " + Process.GetCurrentProcess().Id,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        return 0;
    }

    private static int Perform(string installDirectory, bool deleteData, int parentPid)
    {
        try
        {
            try { Process.GetProcessById(parentPid).WaitForExit(10000); } catch { }
            StopRunningApp();
            using (RegistryKey run = Registry.CurrentUser.OpenSubKey(RunKey, true)) { if (run != null) run.DeleteValue("UBCAssignmentManager", false); }
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            DeleteIfExists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Product + ".lnk"));
            string menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", Product);
            if (Directory.Exists(menu)) Directory.Delete(menu, true);
            string expectedParent = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs")) + Path.DirectorySeparatorChar;
            string fullInstall = Path.GetFullPath(installDirectory);
            if (!fullInstall.StartsWith(expectedParent, StringComparison.OrdinalIgnoreCase) || Path.GetFileName(fullInstall) != Product)
                throw new InvalidOperationException("安装目录验证失败。");
            if (Directory.Exists(fullInstall)) Directory.Delete(fullInstall, true);
            if (deleteData)
            {
                string dataRoot = Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Product));
                if (Directory.Exists(dataRoot)) Directory.Delete(dataRoot, true);
            }
            MessageBox.Show(deleteData ? "应用和个人数据已删除。" : "应用已卸载，个人数据已保留。", Product, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show("卸载失败：" + error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void DeleteIfExists(string file) { if (File.Exists(file)) File.Delete(file); }

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
}
