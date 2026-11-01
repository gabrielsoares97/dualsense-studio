# DualSense Studio - verifica e desfaz a conexão Bluetooth do DualSense.
# Com Bluetooth e USB ativos ao mesmo tempo, o controle desliga a placa de som USB
# (hápticos HD, alto-falante e microfone). Desconectar o Bluetooth não apaga o pareamento:
# basta apertar o botão PS sem o cabo para voltar a usar sem fio.
# Uso: bluetooth.ps1 status
#      bluetooth.ps1 disconnect 44:46:48:EB:45:15
param([string]$Action = 'status', [string]$Mac = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-Status {
  # Controles Sony pareados (VID 0x054C = 1356) e se o link Bluetooth está ativo agora.
  $list = foreach ($n in @(Get-PnpDevice -PresentOnly -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^BTHENUM\\DEV_[0-9A-F]{12}' })) {
    $vid = (Get-PnpDeviceProperty -InstanceId $n.InstanceId -KeyName 'DEVPKEY_Bluetooth_DeviceVID' -ErrorAction SilentlyContinue).Data
    if ($vid -ne 1356) { continue }
    $conn = (Get-PnpDeviceProperty -InstanceId $n.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15' -ErrorAction SilentlyContinue).Data
    $mac = ($n.InstanceId -replace '^BTHENUM\\DEV_([0-9A-F]{12}).*$', '$1') -replace '(..)(?!$)', '$1:'
    [pscustomobject]@{ mac = $mac; name = $n.FriendlyName; connected = [bool]$conn }
  }
  [pscustomobject]@{ devices = @($list) }
}

if ($Action -eq 'disconnect') {
  if ($Mac -notmatch '^([0-9A-Fa-f]{2}[:-]?){5}[0-9A-Fa-f]{2}$') { throw 'MAC inválido' }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DsBluetooth {
  [StructLayout(LayoutKind.Sequential)] struct FIND_RADIO_PARAMS { public int dwSize; }
  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstRadio(ref FIND_RADIO_PARAMS p, out IntPtr radio);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindNextRadio(IntPtr find, out IntPtr radio);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindRadioClose(IntPtr find);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(IntPtr h, uint code, ref long inBuf, int inSize, IntPtr outBuf, int outSize, out int returned, IntPtr ov);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  const uint IOCTL_BTH_DISCONNECT_DEVICE = 0x41000C;

  public static string Disconnect(long address) {
    var p = new FIND_RADIO_PARAMS { dwSize = Marshal.SizeOf(typeof(FIND_RADIO_PARAMS)) };
    IntPtr radio;
    IntPtr find = BluetoothFindFirstRadio(ref p, out radio);
    if (find == IntPtr.Zero) return "nenhum adaptador Bluetooth encontrado";
    int lastError = 0;
    try {
      while (radio != IntPtr.Zero) {
        int ret;
        bool ok = DeviceIoControl(radio, IOCTL_BTH_DISCONNECT_DEVICE, ref address, 8, IntPtr.Zero, 0, out ret, IntPtr.Zero);
        if (!ok) lastError = Marshal.GetLastWin32Error();
        CloseHandle(radio);
        if (ok) return "ok";
        if (!BluetoothFindNextRadio(find, out radio)) radio = IntPtr.Zero;
      }
    } finally { BluetoothFindRadioClose(find); }
    return "falhou (erro " + lastError + ")";
  }
}
'@
  $hex = ($Mac -replace '[:-]', '')
  $result = [DsBluetooth]::Disconnect([Convert]::ToInt64($hex, 16))
  Start-Sleep -Milliseconds 1500
  ConvertTo-Json -Compress -Depth 4 -InputObject ([pscustomobject]@{ result = $result; devices = (Get-Status).devices })
} else {
  ConvertTo-Json -Compress -Depth 4 -InputObject (Get-Status)
}
