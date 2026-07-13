import { useState, useCallback, useRef } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

const STORAGE_KEY = 'lumos_google_access_token';
const FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

export function useGoogleDrive() {
  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem(STORAGE_KEY)
  );

  // Resolvedores pendentes de ensureAuth(): resolvem quando o popup termina.
  const pendingAuth = useRef<((ok: boolean) => void)[]>([]);
  const settleAuth = (ok: boolean) => {
    const list = pendingAuth.current;
    pendingAuth.current = [];
    list.forEach(fn => fn(ok));
  };

  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      const token = tokenResponse.access_token;
      const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
      setAccessToken(token);
      localStorage.setItem(STORAGE_KEY, token);
      localStorage.setItem(STORAGE_KEY + '_expires_at', expiresAt.toString());
      settleAuth(true);
    },
    onError: () => settleAuth(false),
    onNonOAuthError: () => settleAuth(false),
    scope: 'https://www.googleapis.com/auth/drive',
    // Sem 'consent' forçado: se a pessoa já autorizou, o Google devolve o token
    // sem reexibir a tela toda vez (menos atrito). Só pede consentimento na 1ª vez.
    flow: 'implicit'
  });

  const isAuthenticated = useCallback(() => {
    if (!accessToken) return false;
    const expiresAtStr = localStorage.getItem(STORAGE_KEY + '_expires_at');
    if (expiresAtStr) {
      const expiresAt = parseInt(expiresAtStr, 10);
      if (Date.now() >= expiresAt) {
        setAccessToken(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_expires_at');
        return false;
      }
    }
    return true;
  }, [accessToken]);

  const listFiles = useCallback(async (query: string) => {
    if (!accessToken) throw new Error('Not authenticated with Google Drive');
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: { message: 'Unknown error' } };
      }
      if (response.status === 401) {
        setAccessToken(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_expires_at');
      }
      throw new Error(errorData.error?.message || `Failed to list files (${response.status})`);
    }
    return await response.json();
  }, [accessToken]);

  const createFolder = useCallback(async (name: string, parentId?: string) => {
    if (!accessToken) throw new Error('Not authenticated with Google Drive');
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : []
    };
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      }
    );
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: { message: 'Unknown error' } };
      }
      if (response.status === 401) {
        setAccessToken(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_expires_at');
      }
      throw new Error(errorData.error?.message || `Failed to create folder (${response.status})`);
    }
    return await response.json();
  }, [accessToken]);

  const uploadToDrive = useCallback(async (fileBlob: Blob, fileName: string, mimeType: string = 'application/pdf', folderId?: string) => {
    if (!accessToken) throw new Error('Not authenticated with Google Drive');

    const boundary = '-------lumos_boundary_';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = JSON.stringify({
      name: fileName,
      parents: [folderId || FOLDER_ID]
    });

    try {
      const metadataPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`;
      const filePartHeader = `Content-Type: ${mimeType}\r\n\r\n`;
      
      const body = new Blob([
        delimiter,
        metadataPart,
        delimiter,
        filePartHeader,
        fileBlob,
        closeDelimiter
      ], { type: `multipart/related; boundary=${boundary}` });

      // Shared Drive support requires supportsAllDrives and includeItemsFromAllDrives parameters
      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=id,name,mimeType,webViewLink',
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: body
        }
      );

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: { message: 'Unknown error' } };
        }
        
        if (response.status === 401) {
          setAccessToken(null);
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(STORAGE_KEY + '_expires_at');
        }
        throw new Error(errorData.error?.message || `Failed to upload to Google Drive (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      throw err;
    }
  }, [accessToken]);

  // Cria um arquivo nativo do Google (Docs/Sheets/Slides) dentro de uma pasta.
  // mimeType: application/vnd.google-apps.{document|spreadsheet|presentation}
  const createGoogleFile = useCallback(async (name: string, mimeType: string, parentId?: string) => {
    if (!accessToken) throw new Error('Not authenticated with Google Drive');
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType, parents: parentId ? [parentId] : [] }),
      }
    );
    if (!response.ok) {
      let errorData;
      try { errorData = await response.json(); } catch { errorData = { error: { message: 'Unknown error' } }; }
      if (response.status === 401) {
        setAccessToken(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + '_expires_at');
      }
      throw new Error(errorData.error?.message || `Failed to create Google file (${response.status})`);
    }
    return await response.json();
  }, [accessToken]);

  // Garante autenticação sem obrigar clique extra: se já está válido, resolve
  // na hora; senão abre o popup e resolve quando o token chega (ou falha).
  const ensureAuth = useCallback((): Promise<boolean> => {
    if (isAuthenticated()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      pendingAuth.current.push(resolve);
      login();
    });
  }, [isAuthenticated, login]);

  return {
    login,
    ensureAuth,
    uploadToDrive,
    isAuthenticated,
    accessToken,
    listFiles,
    createFolder,
    createGoogleFile
  };
}
