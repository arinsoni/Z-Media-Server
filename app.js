const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { google } = require('googleapis');



dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const spreadsheetId = process.env.spreadsheet_Id
console.log(spreadsheetId)
const key = process.env.KEY_FILE


app.use(cors());
app.use(express.json());


const range = 'Sheet1!A:A';
const articleRange = 'Sheet1!B:B';


async function authenticateWithGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  return sheets;
}





mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));


const cacheSchema = new mongoose.Schema({
  instagramUrl: { type: String, required: true, unique: true },
  downloadUrl: { type: String, required: true }
});


const articleSchema = new mongoose.Schema({
  articleUrl: { type: String, required: true, unique: true },
  content: { type: String, required: true } 
});

const Article = mongoose.model('Article', articleSchema);



async function fetchAndSaveArticleContent(articleUrl) {

  const existingArticle = await Article.findOne({ articleUrl });
  if (existingArticle && existingArticle.content) {
    console.log(`Content already exists for ${articleUrl}. Skipping fetch.`);
    return;
  }


  const apiURL = 'https://news-article-data-extract-and-summarization1.p.rapidapi.com/extract/';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': 'b463ff8896msh724c131412119a5p15a891jsn89e7286a127d',
      'X-RapidAPI-Host': 'news-article-data-extract-and-summarization1.p.rapidapi.com'
    },
    body: JSON.stringify({ url: articleUrl })
  };

  try {

    const response = await fetch(apiURL, options);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
    }
    const content = await response.json();


    if (!content || Object.keys(content).length === 0) {
      console.error(`No content fetched for ${articleUrl}.`);
      return;
    }


    await Article.findOneAndUpdate({ articleUrl }, { content: JSON.stringify(content) }, { new: true, upsert: true });
    console.log(`Content saved for ${articleUrl}`);
  } catch (error) {
    console.error(`Failed to save article content for ${articleUrl}:`, error);
  }
}
const { OpenAI } = require('openai');

const contentPrompt = `Given the following news article, summarize the key points in a concise and informative manner, ensuring to capture the main events, significant figures involved, and any important dates or locations. The summary should provide a clear understanding of the article's content without needing to read the full text. Please keep the summary under 60 words.
`;

const titlePrompt = `Given the following news article, summarize the title in a concise and informative manner, ensuring to capture the main events, significant figures involved, and any important dates or locations. The summary should provide a clear understanding of the article's title without needing to read the full text. Please keep the summary under 12 words.
`;


const openai = new OpenAI(process.env.OPENAI_API_KEY);
client = new OpenAI(api_key = openai.api_key)

async function getGPTres(prompt, param) {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: param == "title" ? titlePrompt : contentPrompt },
        { role: "user", content: prompt },
      ],
    });
    return response.choices[0].message.content

  } catch (error) {
    console.error('Error getting GPT response:', error);
    return null;
  }
}


async function fetchArticles()  {
  try {
    const sheets = await authenticateWithGoogleSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: articleRange,
    });

    const articleUrls = response.data.values ? response.data.values.flat() : [];

    await Promise.all(articleUrls.map(url => fetchAndSaveArticleContent(url)));


    const articles = await Article.find({});
   
    return articles
  } catch (error) {
    console.error('Failed to get article content:', error);
  }
}

function cleanArticleContent(content) {
  const cleanedContent = content
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ') 
    .trim(); 
  return cleanedContent;
}


async function parseArticleContent(articles) {
  const promises = articles.map(async article => {
    try {
      const content = JSON.parse(article.content);
      const summaryTitle = await getGPTres(content.title, "title"); 
      const cleanedText = cleanArticleContent(content.text, "content");
      const summaryContent = await getGPTres(cleanedText); 
      console.log(summaryContent);
      return {
        _id: article._id,
        articleUrl: article.articleUrl,
        title: summaryTitle,
        text: summaryContent, 
      };
    } catch (error) {
      console.error(`Failed to parse and summarize article content for ID ${article._id}:`, error);
      return null; 
    }
  });

  const parsedArticles = await Promise.all(promises);
  return parsedArticles.filter(article => article !== null); 
}


app.get('/getArticles', async (req, res) => {
  try {
    const articles = await fetchArticles();
    const parsedArticles = await parseArticleContent(articles);
    res.json(parsedArticles);
  } catch (error) {
    console.error('Failed to fetch articles:', error);
    res.status(500).send('Failed to fetch articles');
  }
});




const Cache = mongoose.model('Cache', cacheSchema);


async function fetchAndCacheReelDownloadUrl(instagramUrl) {
  const url = `https://instagram-post-reels-stories-downloader.p.rapidapi.com/instagram/?url=${encodeURIComponent(instagramUrl)}`;
  const options = {
    method: 'GET',
    headers: {
      'X-RapidAPI-Key': process.env.RAPID_API,
      'X-RapidAPI-Host': 'instagram-post-reels-stories-downloader.p.rapidapi.com'
    }
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    const downloadUrl = data.result[0].url;

    await Cache.findOneAndUpdate({ instagramUrl }, { downloadUrl }, { new: true, upsert: true });
    return downloadUrl;
  } catch (error) {
    console.error(`Failed to fetch download URL for ${instagramUrl}:`, error);
    throw error;
  }
}


app.get('/getVideos', async (req, res) => {
  try {
    const sheets = await authenticateWithGoogleSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const instagramReelUrls = response.data.values ? response.data.values.flat() : [];
    await Promise.all(instagramReelUrls.map(url => fetchAndCacheReelDownloadUrl(url)));


    const videoUrls = await Cache.find({});
    res.json(videoUrls);
  } catch (error) {
    console.error('Failed to get video URLs:', error);
    res.status(500).send('Failed to get video URLs');
  }
});



app.get('/video-proxy', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).send("URL is required");
  }

  try {
    const decodedUrl = decodeURIComponent(videoUrl);
    const videoResponse = await fetch(decodedUrl);
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);
    }
    res.setHeader('Content-Type', videoResponse.headers.get('Content-Type'));
    videoResponse.body.pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to fetch video');
  }
});






app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
