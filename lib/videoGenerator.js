/**
 * Video Generator Client
 * Frontend helper for calling video generation APIs
 */

const API_BASE = '/api';

export const VideoGenerator = {
  /**
   * Upload image and get URL for processing
   */
  async uploadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: e.target.result,
              filename: file.name,
            }),
          });
          
          if (!response.ok) {
            throw new Error('Upload failed');
          }
          
          const data = await response.json();
          resolve(data.imageUrl);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },

  /**
   * Start video generation
   */
  async generate(options) {
    const { imageUrl, prompt, mode, rewriteText, stage, genre } = options;

    const response = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl,
        prompt,
        mode,
        rewriteText,
        stage,
        genre,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Generation failed');
    }

    return response.json();
  },

  /**
   * Check generation status
   */
  async checkStatus(predictionId) {
    const response = await fetch(`${API_BASE}/status/${predictionId}`);
    
    if (!response.ok) {
      throw new Error('Failed to check status');
    }

    return response.json();
  },

  /**
   * Poll for completion
   */
  async waitForCompletion(predictionId, onProgress) {
    const maxAttempts = 120; // 10 minutes max (5s intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      const status = await this.checkStatus(predictionId);
      
      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'succeeded') {
        return status;
      }

      if (status.status === 'failed' || status.status === 'canceled') {
        throw new Error(status.error || 'Generation failed');
      }

      // Wait 5 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Generation timeout');
  },

  /**
   * Full generation flow
   */
  async createVideo(file, options, onProgress) {
    // 1. Upload image
    onProgress?.({ step: 'uploading', message: '이미지 업로드 중...' });
    const imageUrl = await this.uploadImage(file);

    // 2. Start generation
    onProgress?.({ step: 'starting', message: '영상 생성 시작...' });
    const { id } = await this.generate({ ...options, imageUrl });

    // 3. Wait for completion
    onProgress?.({ step: 'generating', message: '영상 생성 중... (1-3분 소요)' });
    const result = await this.waitForCompletion(id, (status) => {
      onProgress?.({ 
        step: 'generating', 
        message: `영상 생성 중... (${status.status})`,
        status 
      });
    });

    // 4. Return video URL
    onProgress?.({ step: 'complete', message: '완료!' });
    return {
      videoUrl: result.output,
      predictionId: id,
    };
  },
};

// Export for use in browser
if (typeof window !== 'undefined') {
  window.VideoGenerator = VideoGenerator;
}

export default VideoGenerator;

