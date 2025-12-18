/**
 * Video Generator Client (Browser Version)
 * Frontend helper for calling video generation APIs
 */

const VideoGenerator = {
  API_BASE: '/api',

  /**
   * Upload image and get URL for processing
   */
  async uploadImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const response = await fetch(`${this.API_BASE}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: e.target.result,
              filename: file.name,
            }),
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Upload failed');
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

    const response = await fetch(`${this.API_BASE}/generate`, {
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
    const response = await fetch(`${this.API_BASE}/status/${predictionId}`);
    
    if (!response.ok) {
      throw new Error('Failed to check status');
    }

    return response.json();
  },

  /**
   * Poll for completion with progress callback
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
   * Full generation flow - from file to video
   */
  async createVideo(file, options, onProgress) {
    try {
      // 1. Upload image
      onProgress?.({ step: 'uploading', progress: 10, message: '이미지 업로드 중...' });
      const imageUrl = await this.uploadImage(file);

      // 2. Start generation
      onProgress?.({ step: 'starting', progress: 20, message: '영상 생성 요청 중...' });
      const { id } = await this.generate({ ...options, imageUrl });

      // 3. Wait for completion with progress updates
      let progressValue = 20;
      const result = await this.waitForCompletion(id, (status) => {
        progressValue = Math.min(progressValue + 2, 90);
        onProgress?.({ 
          step: 'generating', 
          progress: progressValue,
          message: `영상 생성 중... (${status.status})`,
          status 
        });
      });

      // 4. Return video URL
      onProgress?.({ step: 'complete', progress: 100, message: '완료!' });
      
      return {
        success: true,
        videoUrl: Array.isArray(result.output) ? result.output[0] : result.output,
        predictionId: id,
      };
    } catch (error) {
      onProgress?.({ step: 'error', progress: 0, message: error.message });
      throw error;
    }
  },

  /**
   * Generate multiple clips (for Quick/Story pack)
   */
  async createMultipleClips(file, options, clipCount = 3, onProgress) {
    const clips = [];
    
    for (let i = 0; i < clipCount; i++) {
      onProgress?.({ 
        step: 'generating', 
        clipIndex: i, 
        totalClips: clipCount,
        message: `클립 ${i + 1}/${clipCount} 생성 중...` 
      });

      const result = await this.createVideo(file, {
        ...options,
        clipIndex: i,
      }, (progress) => {
        onProgress?.({
          ...progress,
          clipIndex: i,
          totalClips: clipCount,
          overallProgress: ((i / clipCount) + (progress.progress / 100 / clipCount)) * 100,
        });
      });

      clips.push(result);
    }

    return clips;
  },
};

// Make available globally
window.VideoGenerator = VideoGenerator;


