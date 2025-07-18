const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
app.use(cors());
app.use(bodyParser.json());

let projectId = null;

app.post('/auth-veo', async (req, res) => {
  try {
    const key = req.body.serviceAccount;

    // Escreve o JSON em disco temporário
    const credPath = path.join('/tmp', 'gsa.json');
    fs.writeFileSync(credPath, JSON.stringify(key));

    // Seta a variável de ambiente para o SDK usar
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;

    // Pega projectId do JSON
    projectId = key.project_id;

    res.status(200).send({ message: 'Autenticação realizada com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Erro ao autenticar com o Google Cloud', detalhes: err.message });
  }
});

app.post('/generate-video', async (req, res) => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !projectId) {
    return res.status(400).send({ error: 'Service Account ainda não foi autenticada.' });
  }

  const { prompt } = req.body;

  try {
    const vertexAi = new VertexAI({
      project: projectId,
      location: 'us-central1'
      // O SDK vai buscar o GOOGLE_APPLICATION_CREDENTIALS automaticamente
    });

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

    // LOGA o retorno para debug
    console.log('Resposta VEO3:', JSON.stringify(result, null, 2));

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
