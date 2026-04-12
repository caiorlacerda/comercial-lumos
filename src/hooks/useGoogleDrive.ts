import { useState, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';

const STORAGE_KEY = 'lumos_google_access_token';
const FOLDER_ID = import.meta.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

export function useGoogleDrive() {
  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem(STORAGE_KEY)
  );

  const login = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      const token = tokenResponse.access_token;
      setAccessToken(token);
      localStorage.setItem(STORAGE_KEY, token);
    },
    scope: 'https://www.googleapis.com/auth/drive',
    prompt: 'consent',
    flow: 'implicit'
  });

  const isAuthenticated = useCallback(() => {
    return !!accessToken;
  }, [accessToken]);

  const uploadToDrive = useCallback(async (pdfBlob: Blob, fileName: string) => {
    if (!accessToken) throw new Error('Not authenticated with Google Drive');

    // Multipart/related construction according to Google Drive API v3 documentation
    const boundary = '-------lumos_boundary_';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = JSON.stringify({
      name: fileName,
      parents: [FOLDER_ID]
    });

    try {
      const metadataPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`;
      const filePartHeader = `Content-Type: application/pdf\r\n\r\n`;
      
      const body = new Blob([
        delimiter,
        metadataPart,
        delimiter,
        filePartHeader,
        pdfBlob,
        closeDelimiter
      ], { type: `multipart/related; boundary=${boundary}` });

      // Shared Drive support requires supportsAllDrives and includeItemsFromAllDrives parameters
      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&includeItemsFromAllDrives=true', 
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
        }
        throw new Error(errorData.error?.message || `Failed to upload to Google Drive (${response.status})`);
      }

      return await response.json();
    } catch (err) {
      throw err;
    }
  }, [accessToken]);

  return {
    login,
    uploadToDrive,
    isAuthenticated,
    accessToken
  };
}
