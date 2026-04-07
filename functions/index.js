 const { onRequest } = require('firebase-functions/v2/https');
 const Anthropic = require('@anthropic-ai/sdk');
 const sharp = require('sharp');

 const SYSTEM_PROMPT = `You are a precise restaurant menu data extraction system.
Extract ONLY items visible in the image(s). Never invent items.
Arabic text is RTL — item names appear on the right.
READ COLUMN HEADERS FIRST to map sizes (S/صغير, M/وسط, L/كبير) to prices.

CRITICAL RULE FOR GROUPING:
If you find the same core item listed with different portions, sizes, or weights on separate lines (e.g., "ربع فرخة", "نصف فرخة", "فرخة كاملة" OR "بيتزا وسط", "بيتزا كبير"), YOU MUST GROUP THEM into a SINGLE item.
Set the core name (e.g., "فرخة" or "بيتزا") in "name", set "price" to null, and put all the portions/sizes and their prices inside the "variants" array (e.g., "size": "ربع", "size": "نصف").

MULTIPLE IMAGES: If multiple images are provided, extract ALL items from ALL images and merge them into one list. Deduplicate items with the same name.

Return ONLY a valid JSON object matching this exact structure (NO ingredients, NO recipes):
{
  "items": [
    {
      "name": "string",
      "category": "string",
      "price": number or null,
      "variants": [{"size": "string", "price": number}] or null
    }
  ]
}`;

 exports.parseMenuImage = onRequest(
   {
     timeoutSeconds: 120,
     memory: '1GiB',
     cors: true,
     region: 'us-central1',
     secrets: ['ANTHROPIC_API_KEY']
   },
   async (req, res) => {
     try {
       // Accept single image (backward compat) OR array of images
       const body = req.body || req.body?.data || {};
       const singleImage = body.imageBase64 || body.data?.imageBase64;
       const multiImages = body.imagesBase64 || body.data?.imagesBase64; // array

       const rawImages = multiImages && multiImages.length > 0
         ? multiImages
         : singleImage
           ? [singleImage]
           : null;

       if (!rawImages) return res.status(400).json({ error: 'الصور مطلوبة' });

       const toBase64 = async (imageBase64) => {
         const imageBuffer = Buffer.from(imageBase64, 'base64');
         const resizedBuffer = await sharp(imageBuffer)
           .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
           .jpeg({ quality: 85 })
           .toBuffer();
         return resizedBuffer.toString('base64');
       };

       // Resize all images in parallel
       const resizedImages = await Promise.all(rawImages.map(toBase64));

       const anthropic = new Anthropic({
         apiKey: process.env.ANTHROPIC_API_KEY,
       });

       // Build content array: all images + instruction text
       const contentParts = [];
       for (const b64 of resizedImages) {
         contentParts.push({
           type: "image",
           source: {
             type: "base64",
             media_type: "image/jpeg",
             data: b64,
           },
         });
       }
       contentParts.push({
         type: "text",
         text: resizedImages.length > 1
           ? `Extract all menu items from these ${resizedImages.length} menu images and merge into one list.`
           : "Extract the menu data."
       });

       const msg = await anthropic.messages.create({
         model: "claude-sonnet-4-6",
         max_tokens: 8192,
         system: SYSTEM_PROMPT + "\nIMPORTANT: Return ONLY raw JSON. No markdown, no intro, no outro.",
         messages: [
           {
             role: "user",
             content: contentParts,
           }
         ],
       });

       let responseText = msg.content[0].text;
       responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

       if (!responseText.endsWith('}')) {
           const lastBrace = responseText.lastIndexOf('}');
           if (lastBrace !== -1) {
               responseText = responseText.substring(0, lastBrace + 1);
           }
       }

       return res.status(200).json({ result: JSON.parse(responseText) });

     } catch (error) {
       console.error('Claude error:', error);
       return res.status(500).json({ error: error.message || 'خطأ داخلي' });
     }
   }
 );
