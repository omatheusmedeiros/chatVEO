const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { VertexAI } = require('@google-cloud/vertexai');

// ==============================================================================
// INICIALIZAÇÃO E AUTENTICAÇÃO SEGURA
// ==============================================================================

const projectId = process.env.GCLOUD_PROJECT;
const keyBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

if (!projectId || !keyBase64) {
  console.error("ERRO CRÍTICO: As variáveis de ambiente 'GCLOUD_PROJECT' e 'GOOGLE_APPLICATION_CREDENTIALS_BASE64' são obrigatórias.");
  // Em um ambiente de produção, o ideal é que o servidor nem inicie sem elas.
  // process.exit(1);
} else {
  const decodedKey = Buffer.from(keyBase64, 'base64').toString('utf-8');
  const tempCredPath = path.join('/tmp', 'gsa-creds.json');
  fs.writeFileSync(tempCredPath, decodedKey);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;
}

const vertexAi = new VertexAI({ project: projectId, location: 'us-central1' });

// ==============================================================================
// CONFIGURAÇÃO DO SERVIDOR EXPRESS
// ==============================================================================

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==============================================================================
// ROTAS DA API
// ==============================================================================

/**
 * Rota para INICIAR a geração do vídeo.
 * Retorna um 'operationId' para consulta de status.
 */
app.post('/start-video-generation', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).send({ error: 'O campo "prompt" é obrigatório.' });
  }

  try {
    const generativeModel = vertexAi.getGenerativeModel({
      // CORREÇÃO FINAL: Identificador oficial do modelo Veo 3 em preview.
      model: 'veo-3.0-generate-preview',
    });

    const request = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };

    // Inicia a operação de longa duração
    const [operation] = await generativeModel.generateContent(request);
    const operationId = operation.name;
    
    console.log('Geração de vídeo iniciada. Operation ID:', operationId);

    res.status(202).send({ 
      message: 'A geração do vídeo foi iniciada. Verifique o status usando o operationId.',
      operationId: operationId 
    });

  } catch (err) {
    console.error('Erro ao iniciar a geração de vídeo:', err);
    res.status(500).send({ error: 'Erro ao iniciar a geração com a Vertex AI', details: err.message });
  }
});

/**
 * Rota para VERIFICAR o status da geração do vídeo.
 * Deve ser chamada periodicamente (polling) pelo frontend.
 */
app.get('/video-status/:operationId(*)', async (req, res) => {
  const operationName = req.params.operationId;
  if (!operationName) {
    return res.status(400).send({ error: 'O ID da operação é obrigatório.' });
  }

  try {
    const [operation] = await vertexAi.operationsClient.getOperation({ name: operationName });

    if (!operation.done) {
      res.status(200).send({ status: 'PROCESSING', message: 'O vídeo ainda está sendo gerado.' });
    } else {
      if (operation.error) {
        console.error(`Operação ${operationName} falhou:`, operation.error);
        res.status(500).send({ status: 'FAILED', error: 'A geração do vídeo falhou.', details: operation.error });
      } else {
        console.log(`Operação ${operationName} concluída.`);
        const fileUri = operation.response?.candidates?.[0]?.content?.parts?.[0]?.fileData?.fileUri;

        if (fileUri) {
          // A URL gs:// precisa ser convertida para uma URL pública ou assinada para acesso via web.
          const publicUrl = fileUri.replace('gs://', 'https://storage.googleapis.com/');
          res.status(200).send({ 
            status: 'COMPLETED', 
            message: 'Vídeo gerado com sucesso!',
            videoGsUri: fileUri,
            videoPublicUrl: publicUrl
          });
        } else {
          res.status(500).send({ status: 'FAILED', error: 'Operação concluída, mas não foi possível encontrar a URL do vídeo.', details: operation.response });
        }
      }
    }
  } catch (err) {
    console.error(`Erro ao verificar o status da operação ${operationName}:`, err);
    res.status(500).send({ error: 'Erro ao verificar o status da operação.', details: err.message });
  }
});

/**
 * Rota para GERAR UMA IMAGEM usando o modelo Imagen (do Gemini).
 * Retorna a URL de uma imagem gerada.
 */
app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).send({ error: 'O campo "prompt" é obrigatório.' });
  }

  try {
    // Usamos um modelo da família "Imagen" para geração de imagens
    const generativeModel = vertexAi.getGenerativeModel({
      model: 'imagegeneration@006', // Modelo estável e recomendado
    });

    // O formato da requisição para imagens é o mesmo para texto/vídeo
    const request = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    // CORREÇÃO: Usamos o método unificado .generateContent()
    const result = await generativeModel.generateContent(request);

    // A resposta para imagens vem em um formato um pouco diferente
    const response = result.response;
    const firstCandidate = response.candidates && response.candidates[0];

    if (!firstCandidate || !firstCandidate.content || !firstCandidate.content.parts) {
      throw new Error('Resposta da API de imagem inválida ou vazia.');
    }

    // A imagem vem como dados binários codificados em base64
    const imageData = firstCandidate.content.parts[0].fileData;
    
    // CORREÇÃO: Montamos a URL pública do Google Cloud Storage
    const imageUrl = imageData.fileUri.replace('gs://', 'https://storage.googleapis.com/');

    console.log('Imagem gerada com sucesso. URL:', imageUrl);

    res.status(200).send({ imageUrl: imageUrl });

  } catch (err) {
    console.error('Erro ao gerar imagem com o Gemini/Imagen:', err);
    if (err.message && err.message.includes('Quota exceeded')) {
      return res.status(429).send({ error: 'Limite de uso da API de imagens atingido. Por favor, tente novamente mais tarde.' });
    }
    res.status(500).send({ error: 'Erro ao gerar imagem com a Vertex AI', details: err.message });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok' });
});

// ==============================================================================
// INICIALIZAÇÃO DO SERVIDOR
// ==============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  if (projectId) {
    console.log(`Conectado ao projeto GCP: ${projectId}`);
  }
});
