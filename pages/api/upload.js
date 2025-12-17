// Simple base64 image upload handler
// For production, use Vercel Blob, Cloudflare R2, or AWS S3

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, filename } = req.body;

    if (!image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // For now, just return the base64 data URL
    // Replicate accepts base64 data URLs directly
    // In production, upload to cloud storage and return URL
    
    // Validate it's a valid base64 image
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    return res.status(200).json({
      success: true,
      imageUrl: image, // Return base64 directly for Replicate
      message: 'Image ready for processing',
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ 
      error: 'Failed to process upload',
      details: error.message 
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

