using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NikkiSync.WindowsShell.Services;

internal static class LocalPhotoDecoder
{
    private const string Library = "nuan5_decryption.dll";
    internal const string LibrarySha256 = "91A9AFFE5295524AE99CEE1174270C0FADC202B138F45F3B6C9EC36754191514";
    private const int MaxPhotoBytes = 64 * 1024 * 1024;
    private const int MaxDecodedBytes = 2 * 1024 * 1024;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeBytes
    {
        public IntPtr Data;
        public nuint Length;
        public nuint Capacity;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeResult
    {
        public uint Status;
        public NativeBytes Bytes;
    }

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern uint abi_version();
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr media_key_from_str([MarshalAs(UnmanagedType.LPUTF8Str)] string uid);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr media_key_camera_param();
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void free_media_key(IntPtr key);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern NativeResult media_decode_file_bytes_unchecked(byte[] marker, nuint markerLength, byte[] photo, nuint photoLength, IntPtr key);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern NativeResult media_decrypt(byte[] encoded, nuint length, IntPtr key);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void free_c_bytes_ptr(ref NativeBytes bytes);

    internal static int Run()
    {
        try
        {
            using var input = Console.OpenStandardInput();
            using var request = JsonDocument.Parse(input);
            var file = request.RootElement.GetProperty("file").GetString();
            var uid = request.RootElement.GetProperty("uid").GetString();
            var sha256 = request.RootElement.GetProperty("sha256").GetString();
            if (file is null || !Path.IsPathFullyQualified(file) || uid is null || !Regex.IsMatch(uid, @"\A[0-9]{1,20}\z")
                || sha256 is null || sha256.Length != 64)
                return 2;

            var libraryPath = Path.Combine(Environment.CurrentDirectory, Library);
            using (var library = File.OpenRead(libraryPath))
                if (Convert.ToHexString(SHA256.HashData(library)) != LibrarySha256) return 2;
            NativeLibrary.SetDllImportResolver(typeof(LocalPhotoDecoder).Assembly, (name, _, _) =>
                name == Library ? NativeLibrary.Load(libraryPath) : IntPtr.Zero);
            if (abi_version() != 1) return 2;

            using var source = File.OpenRead(file);
            if (source.Length is < 4 or > MaxPhotoBytes) return 2;
            var photoBytes = new byte[source.Length];
            source.ReadExactly(photoBytes);
            if (photoBytes[0] != 0xff || photoBytes[1] != 0xd8
                || !Convert.ToHexString(SHA256.HashData(photoBytes)).Equals(sha256, StringComparison.OrdinalIgnoreCase)) return 2;

            var uidKey = IntPtr.Zero;
            var cameraKey = IntPtr.Zero;
            try
            {
                uidKey = media_key_from_str(uid);
                cameraKey = media_key_camera_param();
                if (uidKey == IntPtr.Zero || cameraKey == IntPtr.Zero) return 2;
                var photo = DecodeText(media_decode_file_bytes_unchecked([0xff, 0xd9], 2, photoBytes, (nuint)photoBytes.Length, uidKey));
                var parameter = Regex.Match(photo, "\"CameraParams\"\\s*:\\s*\"([^\"]+)\"");
                if (!parameter.Success) return 2;
                var encoded = Encoding.UTF8.GetBytes(parameter.Groups[1].Value.Replace("\\/", "/"));
                var camera = DecodeText(media_decrypt(encoded, (nuint)encoded.Length, cameraKey));
                using var output = Console.OpenStandardOutput();
                JsonSerializer.Serialize(output, new { camera, photo });
                return 0;
            }
            finally
            {
                if (uidKey != IntPtr.Zero) free_media_key(uidKey);
                if (cameraKey != IntPtr.Zero) free_media_key(cameraKey);
            }
        }
        catch (Exception)
        {
            // Errors remain generic so private paths and decoded text never enter the service log.
            return 2;
        }
    }

    private static string DecodeText(NativeResult result)
    {
        try
        {
            if (result.Status != 0 || result.Bytes.Data == IntPtr.Zero || result.Bytes.Length is 0 or > MaxDecodedBytes)
                throw new InvalidDataException("Local photo decoder returned no text.");
            var bytes = new byte[(int)result.Bytes.Length];
            Marshal.Copy(result.Bytes.Data, bytes, 0, bytes.Length);
            var padding = bytes[^1];
            var length = padding is >= 1 and <= 16 && padding <= bytes.Length
                && bytes.AsSpan(bytes.Length - padding).IndexOfAnyExcept(padding) < 0
                ? bytes.Length - padding : bytes.Length;
            return Encoding.UTF8.GetString(bytes, 0, length).TrimEnd('\0');
        }
        finally
        {
            if (result.Bytes.Data != IntPtr.Zero) free_c_bytes_ptr(ref result.Bytes);
        }
    }
}
