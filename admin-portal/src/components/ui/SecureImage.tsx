import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Loader2, ImageOff } from 'lucide-react';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    path: string;
    bucket?: string;
}

export function SecureImage({ path, bucket = 'screenshots', className, ...props }: SecureImageProps) {
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchSignedUrl = async () => {
            if (!path) return;
            
            // If it's already a full URL AND NOT a Supabase storage URL, use it directly
            if (path.startsWith('http') && !path.includes('.supabase.co/storage/v1/object/')) {
                setUrl(path);
                setLoading(false);
                return;
            }

            // If it's a Supabase storage URL, extract the path from it
            let finalPath = path;
            if (path.includes('.supabase.co/storage/v1/object/')) {
                // Extract bucket and path (e.g., .../public/avatars/path/to/file)
                const parts = path.split('/avatars/');
                if (parts.length > 1) {
                    finalPath = parts[1];
                }
            }

            try {
                setLoading(true);
                setError(false);
                
                const { data, error: storageError } = await supabase.storage
                    .from(bucket)
                    .createSignedUrl(finalPath, 3600); // 1 hour expiry

                if (storageError) throw storageError;
                if (data?.signedUrl) {
                    setUrl(data.signedUrl);
                } else {
                    setError(true);
                }
            } catch (err) {
                console.error(`Error loading secure image from ${bucket}:`, err);
                setError(true);
            } finally {
                setLoading(false);
            }
        };

        fetchSignedUrl();
    }, [path, bucket]);

    if (loading) {
        return (
            <div className={`flex items-center justify-center bg-slate-50/50 ${className}`}>
                <Loader2 className="w-5 h-5 animate-spin text-blue-600/20" />
            </div>
        );
    }

    if (error || !url) {
        return (
            <div className={`flex items-center justify-center bg-slate-100 text-slate-300 ${className}`}>
                <ImageOff className="w-5 h-5" />
            </div>
        );
    }

    return <img src={url} className={className} {...props} />;
}
