# DualSense Studio - lê e ajusta o volume do Windows dos dispositivos de som do DualSense.
# Uso: audio-endpoints.ps1 get
#      audio-endpoints.ps1 set <render|capture> <volume 0-100> <mudo 0|1>
param([string]$Action = 'get', [string]$Flow = 'render', [int]$Volume = -1, [int]$Mute = -1)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c); int SetMasterVolumeLevel(float l, ref Guid g); int SetMasterVolumeLevelScalar(float l, ref Guid g);
  int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint n, float l, ref Guid g); int SetChannelVolumeLevelScalar(uint n, float l, ref Guid g);
  int GetChannelVolumeLevel(uint n, out float l); int GetChannelVolumeLevelScalar(uint n, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  int OpenPropertyStore(int access, out IPropertyStore ps); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); int GetState(out int s);
}
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int c); int Item(int i, out IMMDevice d); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

public class EpInfo { public string flow; public string name; public int volume; public bool mute; }

public static class DsEndpoints {
  static IEnumerable<KeyValuePair<string, IAudioEndpointVolume>> Each(int flow) {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDeviceCollection col; e.EnumAudioEndpoints(flow, 1, out col);
    int n; col.GetCount(out n);
    for (int i = 0; i < n; i++) {
      IMMDevice d; col.Item(i, out d);
      IPropertyStore ps; d.OpenPropertyStore(0, out ps);
      var key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
      PROPVARIANT v; ps.GetValue(ref key, out v);
      string name = Marshal.PtrToStringUni(v.p) ?? "";
      if (name.IndexOf("DualSense", StringComparison.OrdinalIgnoreCase) < 0 && name.IndexOf("Wireless Controller", StringComparison.OrdinalIgnoreCase) < 0) continue;
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o;
      d.Activate(ref iid, 1, IntPtr.Zero, out o);
      yield return new KeyValuePair<string, IAudioEndpointVolume>(name, (IAudioEndpointVolume)o);
    }
  }
  public static List<EpInfo> Get() {
    var list = new List<EpInfo>();
    for (int flow = 0; flow <= 1; flow++) {
      foreach (var kv in Each(flow)) {
        float lvl; kv.Value.GetMasterVolumeLevelScalar(out lvl); bool m; kv.Value.GetMute(out m);
        list.Add(new EpInfo { flow = flow == 0 ? "render" : "capture", name = kv.Key, volume = (int)Math.Round(lvl * 100), mute = m });
      }
    }
    return list;
  }
  public static void Set(int flow, int volume, int mute) {
    Guid ctx = Guid.Empty;
    foreach (var kv in Each(flow)) {
      if (volume >= 0) kv.Value.SetMasterVolumeLevelScalar(Math.Min(100, volume) / 100f, ref ctx);
      if (mute >= 0) kv.Value.SetMute(mute == 1, ref ctx);
    }
  }
}
'@
if ($Action -eq 'set') { [DsEndpoints]::Set($(if ($Flow -eq 'capture') { 1 } else { 0 }), $Volume, $Mute) }
$items = @([DsEndpoints]::Get() | ForEach-Object { [pscustomobject]@{ flow = $_.flow; name = $_.name; volume = $_.volume; mute = $_.mute } })
ConvertTo-Json -InputObject $items -Compress
