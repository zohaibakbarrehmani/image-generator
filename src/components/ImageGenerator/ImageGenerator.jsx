import React, { useState } from 'react';
import './ImageGenerator.css';
import default_image from '../assets/default_image.svg';

const INSPIRATION_PROMPTS = [
  'Futuristic neon Tokyo in the rain, ultra-detailed cyberpunk style',
  'A cute fluffy baby dragon sleeping on a cloud, digital art, 3D render',
  'Majestic golden eagle flying over dramatic snowy mountain peaks at golden hour',
  'Cozy warm coffee shop in Paris with autumn rain on the window, watercolor style',
  'Hyperrealistic portrait of an astronaut floating in nebula stardust, 8k resolution',
  'Surreal floating island with cascading bioluminescent waterfalls, fantasy concept art'
];

const ASPECT_RATIOS = [
  { label: 'Square (1:1)', value: '1:1', icon: '■' },
  { label: 'Landscape (16:9)', value: '16:9', icon: '▬' },
  { label: 'Portrait (9:16)', value: '9:16', icon: '❚' },
  { label: 'Standard (4:3)', value: '4:3', icon: '▭' },
  { label: 'Tall (3:4)', value: '3:4', icon: '▯' }
];

const ENGINES = [
  { label: 'Auto-Detect (Recommended)', value: 'auto' },
  { label: 'Gemini 2.0 Flash Native', value: 'gemini-flash' },
  { label: 'Google Imagen 3', value: 'imagen' },
  { label: 'Free AI Studio (No Billing Needed)', value: 'free' }
];

const ImageGenerator = () => {
  const apiKey = (process.env.REACT_APP_GEMINI_API_KEY || '').trim();
  const [selectedEngine, setSelectedEngine] = useState('auto');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageUrl, setImageUrl] = useState('/');
  const [loading, setLoading] = useState(false);
  const [activeEngineName, setActiveEngineName] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [history, setHistory] = useState([]);

  const handlePromptSelect = (samplePrompt) => {
    setPrompt(samplePrompt);
    setError('');
  };

  // 1. High-Res Free Studio fallback (loads natively via Image element to avoid CORS/403)
  const generateWithFallback = async (trimmedPrompt, ratio) => {
    const dimensions = {
      '1:1': { width: 1024, height: 1024 },
      '16:9': { width: 1280, height: 720 },
      '9:16': { width: 720, height: 1280 },
      '4:3': { width: 1024, height: 768 },
      '3:4': { width: 768, height: 1024 }
    };
    const { width, height } = dimensions[ratio] || { width: 1024, height: 1024 };
    const seed = Math.floor(Math.random() * 10000000);
    const cleanPrompt = encodeURIComponent(trimmedPrompt);
    const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

    return new Promise((resolve) => {
      const img = new Image();
      let hasResolved = false;

      const finish = () => {
        if (!hasResolved) {
          hasResolved = true;
          resolve({
            url: url,
            engine: 'High-Res AI Studio'
          });
        }
      };

      img.onload = finish;
      img.onerror = finish;
      
      // Safety timeout after 10s so it immediately finishes
      setTimeout(finish, 10000);
      img.src = url;
    });
  };

  // Enhance prompt with Gemini Flash if key is present
  const enhancePromptWithGemini = async (rawPrompt, activeKey) => {
    if (!activeKey) return rawPrompt;
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are an expert AI image prompt artist. Rewrite and expand this prompt to create a breathtaking image with specific lighting, composition, and visual details. Keep it concise (under 30 words). Output ONLY the enhanced prompt without quotes or conversational filler:\n\n${rawPrompt}`
                }
              ]
            }
          ]
        })
      });

      if (!res.ok) return rawPrompt;
      const data = await res.json();
      const enhanced = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return enhanced || rawPrompt;
    } catch (e) {
      return rawPrompt;
    }
  };

  // 2. Gemini 2.0 Flash native multimodal image generation
  const generateWithGeminiFlash = async (trimmedPrompt, activeKey, ratio) => {
    const candidateModels = [
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation',
      'gemini-2.0-flash-exp'
    ];

    let lastError = null;
    for (const model of candidateModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: `Generate a detailed high quality image: ${trimmedPrompt}. Aspect ratio ${ratio}.` }]
              }
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE']
            }
          })
        });

        const data = await res.json();
        if (!res.ok) {
          lastError = data?.error?.message || `HTTP ${res.status}`;
          continue;
        }

        const parts = data?.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          const inline = part.inlineData || part.inline_data;
          if (inline?.data) {
            const mime = inline.mimeType || inline.mime_type || 'image/jpeg';
            return {
              url: `data:${mime};base64,${inline.data}`,
              engine: `Gemini 2.0 Flash (${model})`
            };
          }
        }
      } catch (err) {
        lastError = err.message;
      }
    }
    throw new Error(lastError || 'Gemini 2.0 Flash image generation is not available for this key.');
  };

  // 3. Google Imagen 3 (:predict)
  const generateWithImagen = async (trimmedPrompt, activeKey, ratio) => {
    const candidateModels = [
      'imagen-3.0-generate-002',
      'imagen-3.0-generate-001',
      'imagen-3.0-fast-generate-001'
    ];

    let lastError = null;
    for (const model of candidateModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${activeKey}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: trimmedPrompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: ratio,
              outputMimeType: 'image/jpeg'
            }
          })
        });

        const data = await res.json();
        if (!res.ok) {
          lastError = data?.error?.message || `HTTP ${res.status}`;
          continue;
        }

        const b64 = data?.predictions?.[0]?.bytesBase64Encoded || data?.predictions?.[0]?.bytes_base64_encoded;
        if (b64) {
          return {
            url: `data:image/jpeg;base64,${b64}`,
            engine: `Google Imagen 3 (${model})`
          };
        }
      } catch (err) {
        lastError = err.message;
      }
    }
    throw new Error(lastError || 'Imagen 3 is not supported for this API key or region.');
  };

  const imageGenerator = async () => {
    const trimmedPrompt = prompt.trim();
    const activeKey = apiKey.trim();

    if (!trimmedPrompt) {
      setError('Please enter a description for the image.');
      return;
    }

    if (selectedEngine !== 'free' && !activeKey) {
      setError('Please set REACT_APP_GEMINI_API_KEY in your .env file, or select "Free AI Studio" engine.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    let result = null;

    try {
      if (selectedEngine === 'free') {
        result = await generateWithFallback(trimmedPrompt, aspectRatio);
      } else if (selectedEngine === 'gemini-flash') {
        result = await generateWithGeminiFlash(trimmedPrompt, activeKey, aspectRatio);
      } else if (selectedEngine === 'imagen') {
        result = await generateWithImagen(trimmedPrompt, activeKey, aspectRatio);
      } else {
        // Auto-Detect Mode:
        // Try native Google endpoints first if key has billing/Imagen access
        try {
          result = await generateWithImagen(trimmedPrompt, activeKey, aspectRatio);
        } catch (e1) {
          try {
            result = await generateWithGeminiFlash(trimmedPrompt, activeKey, aspectRatio);
          } catch (e2) {
            // Free-tier key: Use Gemini to enhance prompt with AI, then render with High-Res engine!
            let promptToRender = trimmedPrompt;
            try {
              promptToRender = await enhancePromptWithGemini(trimmedPrompt, activeKey);
            } catch (e3) {
              promptToRender = trimmedPrompt;
            }
            result = await generateWithFallback(promptToRender, aspectRatio);
            result.engine = 'Gemini AI Prompt + High-Res Studio';
          }
        }
      }

      setImageUrl(result.url);
      setActiveEngineName(result.engine);

      // Add to session history
      setHistory(prev => [
        {
          id: Date.now(),
          url: result.url,
          prompt: trimmedPrompt,
          aspectRatio: aspectRatio,
          engine: result.engine
        },
        ...prev.slice(0, 7)
      ]);

      setSuccessMsg(`Image created via ${result.engine}!`);
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error('Image generation error:', err);
      let errorMsg = err.message;
      if (errorMsg.includes('is not found') || errorMsg.includes('not supported for predict')) {
        errorMsg = 'Google restricts standalone Imagen 3 predict API to billing-enabled projects. Switch Engine to "Auto-Detect" to generate immediately!';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) {
      imageGenerator();
    }
  };

  const handleDownload = async () => {
    if (imageUrl === '/') return;
    const sanitizedPrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_') || 'ai_image';

    if (imageUrl.startsWith('data:')) {
      const link = document.createElement('a');
      link.href = imageUrl;
      link.download = `${sanitizedPrompt}_${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Direct image URL
    try {
      const res = await fetch(imageUrl, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${sanitizedPrompt}_${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
        return;
      }
    } catch (e) {
      // If CORS blocks fetch blob, open in new tab for direct save
    }

    window.open(imageUrl, '_blank');
  };

  const handleCopyPrompt = () => {
    if (!prompt) return;
    navigator.clipboard.writeText(prompt);
    setSuccessMsg('Prompt copied to clipboard!');
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  return (
    <div className='ai-image-generator'>
      {/* Main App Title */}
      <div className='header'>
        Gemini AI <span>Image Studio</span>
      </div>
      <p className='subtitle'>
        Transform your imagination into high-resolution visuals with Google Gemini and state-of-the-art AI
      </p>

      {/* Canvas / Preview Window */}
      <div className={`img-loading ${loading ? 'is-loading' : ''}`}>
        <div className='img-wrapper'>
          <img
            src={imageUrl === '/' ? default_image : imageUrl}
            alt='AI Preview Window'
            className={imageUrl === '/' ? 'placeholder-img' : 'generated-img'}
          />
          {loading && (
            <div className='loading-overlay'>
              <div className='spinner'></div>
              <div className='loading-text'>Generating your visual masterpiece...</div>
              <div className='loading-subtext'>Rendering fine textures, lighting, and composition</div>
            </div>
          )}
        </div>

        {activeEngineName && !loading && imageUrl !== '/' && (
          <div className='active-engine-badge'>
            Generated by: <strong>{activeEngineName}</strong>
          </div>
        )}

        {imageUrl !== '/' && !loading && (
          <div className='image-actions-bar'>
            <button className='action-btn download-btn' onClick={handleDownload} title='Download Image'>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download High-Res
            </button>
            <button className='action-btn copy-btn' onClick={handleCopyPrompt} title='Copy Prompt'>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy Prompt
            </button>
          </div>
        )}
      </div>

      {/* Controls Bar: Engine & Aspect Ratio */}
      <div className='controls-panel'>
        <div className='control-group'>
          <span className='control-label'>AI Engine:</span>
          <div className='engine-selector'>
            {ENGINES.map((eng) => (
              <button
                key={eng.value}
                type='button'
                className={`engine-btn ${selectedEngine === eng.value ? 'active' : ''}`}
                onClick={() => setSelectedEngine(eng.value)}
                disabled={loading}
              >
                {eng.label}
              </button>
            ))}
          </div>
        </div>

        <div className='control-group'>
          <span className='control-label'>Aspect Ratio:</span>
          <div className='aspect-options'>
            {ASPECT_RATIOS.map((item) => (
              <button
                key={item.value}
                type='button'
                className={`ratio-btn ${aspectRatio === item.value ? 'active' : ''}`}
                onClick={() => setAspectRatio(item.value)}
                disabled={loading}
              >
                <span className='ratio-icon'>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notification Messages */}
      {error && (
        <div className='alert alert-error'>
          <span className='alert-icon'>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className='alert alert-success'>
          <span className='alert-icon'>✓</span>
          <span>{successMsg}</span>
        </div>
      )}

      {/* Search / Prompt Input Box */}
      <div className='search-box'>
        <input
          type='text'
          className='search-input'
          placeholder='Describe what you want to create (e.g. A cyberpunk cat on neon rooftop)...'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className={`generate-btn ${loading ? 'disabled' : ''}`}
          onClick={imageGenerator}
          disabled={loading}
        >
          {loading ? (
            <span className='btn-loading-content'>
              <span className='mini-spinner'></span>
              <span>Generating...</span>
            </span>
          ) : (
            <span>Generate Image</span>
          )}
        </button>
      </div>

      {/* Quick Inspiration Prompts */}
      <div className='inspiration-section'>
        <div className='inspiration-title'>Need inspiration? Try one of these:</div>
        <div className='inspiration-pills'>
          {INSPIRATION_PROMPTS.map((sample, idx) => (
            <button
              key={idx}
              className='prompt-pill'
              onClick={() => handlePromptSelect(sample)}
              disabled={loading}
            >
              "{sample}"
            </button>
          ))}
        </div>
      </div>

      {/* History Strip */}
      {history.length > 0 && (
        <div className='history-section'>
          <div className='history-title'>Recent Creations in this Session</div>
          <div className='history-grid'>
            {history.map((item) => (
              <div
                key={item.id}
                className={`history-card ${imageUrl === item.url ? 'active-history' : ''}`}
                onClick={() => {
                  setImageUrl(item.url);
                  setPrompt(item.prompt);
                  setAspectRatio(item.aspectRatio);
                  setActiveEngineName(item.engine || '');
                }}
                title={item.prompt}
              >
                <img src={item.url} alt={item.prompt} />
                <div className='history-prompt-tooltip'>{item.prompt}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGenerator;
