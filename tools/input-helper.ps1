# DualSense Studio - auxiliar do Modo PC.
# Lê comandos pela entrada padrão (enviados pelo server.js) e gera mouse/teclado com SendInput.
#   m dx dy   move o mouse      md l|r|m / mu l|r|m   aperta/solta botão
#   w n       roda vertical     hw n                  roda horizontal
#   kd vk     aperta tecla      ku vk                 solta tecla
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DsInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }

  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

  static void Mouse(int dx, int dy, int data, uint flags) {
    var i = new INPUT { type = 0 };
    i.u.mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags };
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }

  static bool IsExtended(int vk) {
    return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5 || vk == 0x2C;
  }

  static void Key(int vk, bool up) {
    var i = new INPUT { type = 1 };
    uint flags = up ? 2u : 0u;
    ushort scan = (ushort)MapVirtualKey((uint)vk, 0);
    bool media = vk >= 0xA6 && vk <= 0xB7;
    if (!media && scan != 0) flags |= 0x0008; // KEYEVENTF_SCANCODE: jogos leem o código físico
    if (IsExtended(vk)) flags |= 0x0001;
    i.u.ki = new KEYBDINPUT { wVk = (ushort)vk, wScan = scan, dwFlags = flags };
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }

  static uint Btn(string b, bool up) {
    if (b == "r") return up ? 0x10u : 0x08u;
    if (b == "m") return up ? 0x40u : 0x20u;
    return up ? 0x04u : 0x02u;
  }

  public static void Run(string line) {
    var p = line.Trim().Split(' ');
    if (p.Length < 2) return;
    try {
      switch (p[0]) {
        case "m": Mouse(int.Parse(p[1]), int.Parse(p[2]), 0, 0x0001); break;
        case "md": Mouse(0, 0, 0, Btn(p[1], false)); break;
        case "mu": Mouse(0, 0, 0, Btn(p[1], true)); break;
        case "w": Mouse(0, 0, int.Parse(p[1]), 0x0800); break;
        case "hw": Mouse(0, 0, int.Parse(p[1]), 0x1000); break;
        case "kd": Key(int.Parse(p[1]), false); break;
        case "ku": Key(int.Parse(p[1]), true); break;
      }
    } catch (Exception) { }
  }
}
'@
[Console]::Out.WriteLine('pronto')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  [DsInput]::Run($line)
}
