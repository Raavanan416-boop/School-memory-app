/**
 * Cloudinary Media Service
 * Replaces Firebase Storage for handling images, videos, and audio.
 */

// TODO: Replace these with your actual Cloudinary credentials
// 1. Go to cloudinary.com -> Dashboard to find your Cloud Name
// 2. Go to Settings -> Upload -> Add upload preset (Mode: Unsigned) to get the Preset Name
const CLOUDINARY_CLOUD_NAME = 'dcjudjdlm'; 
const CLOUDINARY_UPLOAD_PRESET = 'School_memory_app'; 

/**
 * Uploads a file to Cloudinary using an unsigned upload preset.
 * @param {File|Blob} file - The file to upload
 * @param {string} resourceType - 'image', 'video', 'raw', or 'auto'
 * @returns {Promise<{url: string, publicId: string}>} - The secure URL and public ID of the uploaded media
 */
export async function uploadMedia(file, resourceType = 'auto') {
  if (!file) throw new Error('No file provided for upload');

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Upload failed');
    }

    const data = await response.json();
    return { url: data.secure_url, publicId: data.public_id };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
}

/**
 * Note: Cloudinary unsigned uploads cannot be deleted securely from the client-side.
 * This function is a placeholder. For a purely client-side app, we skip deleting 
 * from Cloudinary to protect your API Secret. The media will simply be orphaned 
 * when the Firestore document is deleted.
 */
export async function deleteMedia(url) {
  console.log(`[Cloudinary] Delete requested for ${url}, but unsigned deletion is unsupported client-side. Skipping.`);
  return true;
}
