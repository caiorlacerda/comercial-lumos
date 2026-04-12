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
      console.log('Google Auth Success: Token received');
      const token = tokenResponse.access_token;
      setAccessToken(token);
      localStorage.setItem(STORAGE_KEY, token);
    },
    onError: (error) => console.log('Google Auth Error:', error),
    scope: 'https://www.googleapis.com/auth/drive.file',
    flow: 'implicit'
  });

  const isAuthenticated = useCallback(() => {
    return !!accessToken;
  }, [accessToken]);

  const uploadToDrive = useCallback(async (pdfBlob: Blob, fileName: string) => {
    console.log('Starting upload to Google Drive...', { fileName, folderId: FOLDER_ID });
    
    if (!accessToken) {
      console.log('Upload aborted: No access token found');
      throw new Error('Not authenticated with Google Drive');
    }

    console.log('Access Token (first 20):', accessToken.substring(0, 20));

    // Multipart/related construction according to Google Drive API v3 documentation
    const boundary = '-------lumos_boundary_';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = JSON.stringify({
      name: fileName,
      parents: [FOLDER_ID]
    });

    try {
      // Constructing a multipart/related body manually for better stability across environments
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

      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: body
      });

      console.log('Google Drive API Response:', { 
        status: response.status, 
        statusText: response.statusText,
        ok: response.ok 
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: { message: 'Unknown error' } };
        }
        
        console.log('Google Drive API Error Details:', errorData);
        
        if (response.status === 401) {
          console.log('Token expired (401), clearing storage');
          setAccessToken(null);
          localStorage.removeItem(STORAGE_KEY);
        }
        throw new Error(errorData.error?.message || `Failed to upload to Google Drive (${response.status})`);
      }

      const result = await response.json();
      console.log('Upload Successful result:', result);
      return result;
    } catch (err) {
      console.log('Upload Catch Error:', err);
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
