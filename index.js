const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { GoogleAuth } = require('google-auth-library');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
app.use(cors());
app.use(bodyParser.json());

let authClient = null;
let vertexAi = null;
let projectId = null;

app.post('/auth-veo', async (req, res) => {
  try {
    const key = req.body.serviceAccount;

    const auth = new GoogleAuth({
      credentials: key,
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });

    authClient = await auth.getClient();
    projectId = await auth.getProjectId();

    vertexAi = new VertexAI({
      project: projectId,
      location: 'us-central1',
      auth: authClient,
    });

    res.status(200).send({ message: 'Autenticação realizada com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Erro ao autenticar com o Google Cloud', detalhes: err.message });
  }
});

// NOVA IMPLEMENTAÇÃO PARA GERAR VÍDEO
app.post('/generate-video', async (req, res) => {
  if (!vertexAi) {
    return res.status(400).send({ error: 'Service Account ainda não foi autenticada.' });
  }

  const { prompt } = req.body;

  try {
    // Instancia o modelo generativo do VEO 3
    const model = vertexAi.getGenerativeModel({
      model: 'publishers/google/models/veo-3',
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    });

    // O campo do vídeo pode variar, log para investigar
    console.log('Resposta VEO3:', JSON.stringify(result, null, 2));

    // Tente encontrar a URL do vídeo no retorno
    const videoUrl =
      result?.candidates?.[0]?.content?.parts?.[0]?.video ||
      result?.candidates?.[0]?.content?.parts?.[0]?.fileUrl ||
      null;

    if (videoUrl) {
      res.status(200).send({ videoLink: videoUrl, raw: result });
    } else {
      res.status(500).send({ error: 'Não foi possível obter o vídeo. Veja o retorno:', retorno: result });
    }
  } catch (err) {
    console.error('Erro ao gerar vídeo:', err);
    res.status(500).send({ error: 'Erro ao gerar vídeo com o VEO', detalhes: err.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok' });
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});
