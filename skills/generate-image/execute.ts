import type { SkillContext, SkillResult } from '@devai/shared';

export async function execute(
  args: Record<string, unknown>,
  ctx: SkillContext
): Promise<SkillResult> {
  const prompt = args.prompt as string;
  
  if (!prompt || typeof prompt !== 'string') {
    return { 
      success: false, 
      error: 'Prompt is required and must be a string' 
    };
  }

  // Check if OpenAI API is available
  if (!ctx.apis.openai.available) {
    return { 
      success: false, 
      error: 'OpenAI API key not configured' 
    };
  }

  // Validate and set parameters
  const model = (args.model as string) || 'dall-e-3';
  const size = (args.size as string) || '1024x1024';
  const quality = (args.quality as string) || 'standard';
  const style = (args.style as string) || 'vivid';

  // Validate model
  const validModels = ['dall-e-2', 'dall-e-3'];
  if (!validModels.includes(model)) {
    return { 
      success: false, 
      error: `Invalid model. Must be one of: ${validModels.join(', ')}` 
    };
  }

  // Validate size (depends on model)
  const validSizesDallE3 = ['1024x1024', '1792x1024', '1024x1792'];
  const validSizesDallE2 = ['256x256', '512x512', '1024x1024'];
  
  if (model === 'dall-e-3' && !validSizesDallE3.includes(size)) {
    return { 
      success: false, 
      error: `Invalid size for dall-e-3. Must be one of: ${validSizesDallE3.join(', ')}` 
    };
  }
  
  if (model === 'dall-e-2' && !validSizesDallE2.includes(size)) {
    return { 
      success: false, 
      error: `Invalid size for dall-e-2. Must be one of: ${validSizesDallE2.join(', ')}` 
    };
  }

  // Validate quality
  const validQualities = ['standard', 'hd'];
  if (!validQualities.includes(quality)) {
    return { 
      success: false, 
      error: `Invalid quality. Must be one of: ${validQualities.join(', ')}` 
    };
  }

  // Validate style
  const validStyles = ['vivid', 'natural'];
  if (!validStyles.includes(style)) {
    return { 
      success: false, 
      error: `Invalid style. Must be one of: ${validStyles.join(', ')}` 
    };
  }

  try {
    ctx.log(`Generating image with ${model}: "${prompt.substring(0, 50)}..."`);

    // Build request body
    const requestBody: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size,
    };

    // Add quality and style only for dall-e-3
    if (model === 'dall-e-3') {
      requestBody.quality = quality;
      requestBody.style = style;
    }

    // Call OpenAI API
    const result = await ctx.apis.openai.post('/v1/images/generations', requestBody);

    if (!result || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
      return {
        success: false,
        error: 'No image data returned from OpenAI API'
      };
    }

    const imageData = result.data[0];
    const image = {
      url: imageData.url,
      revisedPrompt: imageData.revised_prompt,
      model,
      size,
      quality,
      style
    };

    ctx.log('Image generated successfully');

    return {
      success: true,
      result: {
        image,
        message: `Image generated successfully using ${model}`
      }
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.log(`Error generating image: ${errorMessage}`);
    
    return {
      success: false,
      error: `Failed to generate image: ${errorMessage}`
    };
  }
}