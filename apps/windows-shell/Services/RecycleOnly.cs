using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace NikkiSync.WindowsShell.Services;

/// <summary>No permanent-delete fallback. One immutable, fingerprinted media file per native operation.</summary>
public static class RecycleOnly
{
    public static bool Validate(string file,string hash,long size)
    {
        if(!Path.IsPathFullyQualified(file)||file.StartsWith(@"\\")||!System.Text.RegularExpressions.Regex.IsMatch(hash,"^[a-f0-9]{64}$")||size<0)return false;
        if(!new[]{".jpg",".jpeg",".png",".webp",".mp4"}.Contains(Path.GetExtension(file).ToLowerInvariant()))return false;
        if(new DriveInfo(Path.GetPathRoot(file)!).DriveType!=DriveType.Fixed)return false;
        for(string? item=Path.GetFullPath(file);item is not null;item=Path.GetDirectoryName(item))
            if((File.GetAttributes(item)&FileAttributes.ReparsePoint)!=0)return false;
        using var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read);
        return stream.Length==size&&Convert.ToHexString(SHA256.HashData(stream)).Equals(hash,StringComparison.OrdinalIgnoreCase);
    }
    public static int Run(string file,string hash,string sizeText)
    {
        try
        {
            if(!long.TryParse(sizeText,out var size)||!Validate(file,hash,size))return 2;
            var operation=(IFileOperation)new FileOperation();IShellItem? item=null;
            var sink=new RecycleSink(()=>Validate(file,hash,size));
            try
            {
                var iid=typeof(IShellItem).GUID;Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(file,IntPtr.Zero,ref iid,out item));
                operation.SetOperationFlags(0x00080000|0x00100000|0x20000000|0x0400|0x2000|0x1000|0x0004|0x0010);
                operation.DeleteItem(item,sink);operation.PerformOperations();operation.GetAnyOperationsAborted(out var aborted);
                return !aborted&&sink.Recycled&&!File.Exists(file)?0:4;
            }
            finally{if(item is not null)Marshal.ReleaseComObject(item);Marshal.ReleaseComObject(operation);GC.KeepAlive(sink);}
        }
        catch{return 5;}
    }
    [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=true)]private static extern int SHCreateItemFromParsingName(string path,IntPtr context,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out IShellItem item);
    [ComImport,Guid("3ad05575-8857-4850-9277-11b85bdb8e09")]private class FileOperation{}
    [ComImport,Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]public interface IShellItem
    {
        void BindToHandler(IntPtr context,ref Guid handler,ref Guid iid,out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind,out IntPtr name);
        void GetAttributes(uint mask,out uint attributes);
        void Compare(IShellItem other,uint hint,out int order);
    }
    [ComImport,Guid("947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface IFileOperation
    {
        void Advise(IFileOperationProgressSink sink,out uint cookie);void Unadvise(uint cookie);
        void SetOperationFlags(uint flags);void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)]string message);
        void SetProgressDialog(IntPtr dialog);void SetProperties(IntPtr properties);void SetOwnerWindow(uint window);
        void ApplyPropertiesToItem(IShellItem item);void ApplyPropertiesToItems(IntPtr items);
        void RenameItem(IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name,IFileOperationProgressSink sink);void RenameItems(IntPtr items,[MarshalAs(UnmanagedType.LPWStr)]string name);
        void MoveItem(IShellItem item,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name,IFileOperationProgressSink sink);void MoveItems(IntPtr items,IShellItem destination);
        void CopyItem(IShellItem item,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name,IFileOperationProgressSink sink);void CopyItems(IntPtr items,IShellItem destination);
        void DeleteItem(IShellItem item,IFileOperationProgressSink sink);void DeleteItems(IntPtr items);
        void NewItem(IShellItem destination,uint attributes,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,IFileOperationProgressSink sink);
        void PerformOperations();void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)]out bool aborted);
    }
    [ComVisible(true),Guid("04b0f1a7-9490-44bc-96e1-4296a31252e2"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]public interface IFileOperationProgressSink
    {
        [PreserveSig]int StartOperations();[PreserveSig]int FinishOperations(int result);
        [PreserveSig]int PreRenameItem(uint flags,IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name);
        [PreserveSig]int PostRenameItem(uint flags,IShellItem item,[MarshalAs(UnmanagedType.LPWStr)]string name,int result,IShellItem? created);
        [PreserveSig]int PreMoveItem(uint flags,IShellItem item,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name);
        [PreserveSig]int PostMoveItem(uint flags,IShellItem item,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name,int result,IShellItem? created);
        [PreserveSig]int PreCopyItem(uint flags,IShellItem item,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name);
        [PreserveSig]int PostCopyItem(uint flags,IShellItem item,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name,int result,IShellItem? created);
        [PreserveSig]int PreDeleteItem(uint flags,IShellItem item);
        [PreserveSig]int PostDeleteItem(uint flags,IShellItem item,int result,IShellItem? created);
        [PreserveSig]int PreNewItem(uint flags,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name);
        [PreserveSig]int PostNewItem(uint flags,IShellItem destination,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,uint attributes,int result,IShellItem? created);
        [PreserveSig]int UpdateProgress(uint total,uint complete);[PreserveSig]int ResetTimer();[PreserveSig]int PauseTimer();[PreserveSig]int ResumeTimer();
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]public sealed class RecycleSink(Func<bool> validate):IFileOperationProgressSink
    {
        public bool Recycled{get;private set;}
        public int PreDeleteItem(uint flags,IShellItem item){try{return (flags&0x80)!=0&&validate()?0:unchecked((int)0x80004004);}catch{return unchecked((int)0x80004004);}}
        public int PostDeleteItem(uint flags,IShellItem item,int result,IShellItem? created){Recycled=result>=0&&created is not null&&(flags&0x80)!=0;return 0;}
        public int StartOperations()=>0;public int FinishOperations(int result)=>0;
        public int PreRenameItem(uint f,IShellItem i,string n)=>unchecked((int)0x80004004);public int PostRenameItem(uint f,IShellItem i,string n,int r,IShellItem? c)=>0;
        public int PreMoveItem(uint f,IShellItem i,IShellItem d,string n)=>unchecked((int)0x80004004);public int PostMoveItem(uint f,IShellItem i,IShellItem d,string n,int r,IShellItem? c)=>0;
        public int PreCopyItem(uint f,IShellItem i,IShellItem d,string n)=>unchecked((int)0x80004004);public int PostCopyItem(uint f,IShellItem i,IShellItem d,string n,int r,IShellItem? c)=>0;
        public int PreNewItem(uint f,IShellItem d,string n)=>unchecked((int)0x80004004);public int PostNewItem(uint f,IShellItem d,string n,string t,uint a,int r,IShellItem? c)=>0;
        public int UpdateProgress(uint t,uint c)=>0;public int ResetTimer()=>0;public int PauseTimer()=>0;public int ResumeTimer()=>0;
    }
}
