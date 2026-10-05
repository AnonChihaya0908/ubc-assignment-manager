using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;

[assembly: AssemblyTitle("UBC作业管理工具")]
[assembly: AssemblyProduct("UBC作业管理工具")]
[assembly: AssemblyVersion("1.3.0.0")]
[assembly: AssemblyFileVersion("1.3.0.0")]

internal static class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string message, string title, uint type);

    [STAThread]
    private static int Main(string[] commandLineArguments)
    {
        string appDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string nodePath = Path.Combine(appDirectory, "runtime", "node.exe");
        string appPath = Path.Combine(appDirectory, "app.js");

        if (!File.Exists(nodePath) || !File.Exists(appPath))
        {
            ShowError("应用文件不完整。请保留 exe、runtime、lib、public 和 app.js 在同一个应用文件夹中。");
            return 1;
        }

        try
        {
            string arguments = "\"" + appPath + "\"";
            bool background = false;
            foreach (string argument in commandLineArguments)
                if (String.Equals(argument, "--background", StringComparison.OrdinalIgnoreCase))
                    background = true;
            if (background || Environment.GetEnvironmentVariable("PRAIRIELEARN_NO_OPEN") == "1")
                arguments += " --no-open";
            ProcessStartInfo start = new ProcessStartInfo(nodePath)
            {
                Arguments = arguments,
                WorkingDirectory = appDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            using (Process child = Process.Start(start))
            {
                if (child == null)
                    throw new InvalidOperationException("后台进程未能启动。");
                if (child.WaitForExit(1500) && child.ExitCode != 0)
                    throw new InvalidOperationException("后台进程启动失败。请确认端口 43873 未被其他程序占用，并检查 Microsoft Edge 是否已安装。");
            }
            return 0;
        }
        catch (Exception error)
        {
            ShowError("无法启动 UBC作业管理工具：" + error.Message);
            return 1;
        }
    }

    private static void ShowError(string message)
    {
        MessageBoxW(IntPtr.Zero, message, "UBC作业管理工具", 0x10);
    }
}
