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

app.post('/generate-video', async (req, res) => {
  if (!vertexAi) {
    return res.status(400).send({ error: 'Service Account ainda não foi autenticada.' });
  }

  const { prompt } = req.body;

  try {
    // Caminho completo do modelo VEO 3.0 usando seu Project ID
    const model = 'projects/refined-iridium-466204-v2/locations/us-central1/publishers/google/models/veo-3';

    const response = await vertexAi.preview(model).predict({
      instances: [{ prompt }],
    });

    console.log('Resposta VEO3:', response);

    // Procure pelo campo correto do vídeo no retorno
    let videoUrl = null;
    if (response?.[0]?.videoUrl) videoUrl = response[0].videoUrl;
    else if (response?.data?.output?.videoUrl) videoUrl = response.data.output.videoUrl;
    else if (response?.predictions?.[0]?.videoUrl) videoUrl = response.predictions[0].videoUrl;

    if (videoUrl) {
      res.status(200).send({ videoLink: videoUrl, raw: response });
    } else {
      res.status(500).send({ error: 'Não foi possível obter o vídeo. Verifique o retorno da API.', retorno: response });
    }
  } catch (err) {
    console.error('Erro ao gerar vídeo:', err);
    res.status(500).send({ error: 'Erro ao gerar vídeo com o VEO', detalhes: err.message });
  }
});

app.listen(3000, () => {
  console.log('Servidor rodando na porta 3000');
});
