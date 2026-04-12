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
    scope: 'https://www.googleapis.com/auth/drive.file',
    flow: 'implicit'
  });

  const isAuthenticated = useCallback(() => {
    return !!accessToken;
  }, [accessToken]);

  const uploadToDrive = useCallback(async (pdfBlob: Blob, fileName: string) => {
    if (!accessToken) throw new Error('Not authenticated with Google Drive');

    const metadata = {
      name: fileName,
      parents: [FOLDER_ID]
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', pdfBlob);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${accessToken}`,
      },
      body: form
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 401) {
        // Token might be expired
        setAccessToken(null);
        localStorage.removeItem(STORAGE_KEY);
      }
      throw new Error(error.error?.message || 'Failed to upload to Google Drive');
    }

    return await response.json();
  }, [accessToken]);

  return {
    login,
    uploadToDrive,
    isAuthenticated,
    accessToken
  };
}
