const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { VertexAI } = require('@google-cloud/vertexai');

// ==============================================================================
// INICIALIZAÇÃO E AUTENTICAÇÃO
// ==============================================================================

// 1. Pega o ID do projeto e a chave Base64 das variáveis de ambiente.
//    (Configure-as no painel do Lovable)
const projectId = process.env.GCLOUD_PROJECT;
const keyBase64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;

if (!projectId || !keyBase64) {
  console.error("ERRO CRÍTICO: As variáveis de ambiente 'GCLOUD_PROJECT' e 'GOOGLE_APPLICATION_CREDENTIALS_BASE64' são obrigatórias.");
  // Em um ambiente real, isso impediria o servidor de iniciar.
  // process.exit(1);
}

// 2. Decodifica a chave Base64 e a escreve em um arquivo temporário.
//    O SDK do Google Cloud usará este arquivo para se autenticar automaticamente.
const decodedKey = Buffer.from(keyBase64, 'base64').toString('utf-8');
const tempCredPath = path.join('/tmp', 'gsa-creds.json');
fs.writeFileSync(tempCredPath, decodedKey);

// 3. Seta a variável de ambiente para que o SDK encontre as credenciais.
process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;

// 4. Instancia o cliente da Vertex AI.
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
 * Rota para iniciar a geração do vídeo.
 * A geração de vídeo é uma tarefa demorada (long-running operation).
 * Esta rota NÃO retorna o vídeo final. Ela inicia o processo na Vertex AI e
 * retorna um 'operationId' que você usará para verificar o status.
 */
app.post('/start-video-generation', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).send({ error: 'O campo "prompt" é obrigatório.' });
  }

  try {
    const generativeModel = vertexAi.getGenerativeModel({
      model: 'imagen-3.0-generate-video-hd', // Modelo correto para vídeo HD
    });

    const request = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };

    // Inicia a geração e obtém a operação de longa duração
    const [operation] = await generativeModel.generateContent(request);
    
    // O 'name' da operação é o ID que usaremos para consultar o status
    const operationId = operation.name;
    
    console.log('Geração de vídeo iniciada. Operation ID:', operationId);

    res.status(202).send({ 
      message: 'A geração do vídeo foi iniciada com sucesso. Verifique o status usando o operationId.',
      operationId: operationId 
    });

  } catch (err) {
    console.error('Erro ao iniciar a geração de vídeo:', err);
    res.status(500).send({ error: 'Erro ao iniciar a geração com a Vertex AI', details: err.message });
  }
});


/**
 * Rota para verificar o status da geração do vídeo.
 * O frontend deve chamar esta rota periodicamente (polling) com o 'operationId'
 * recebido da rota '/start-video-generation'.
 */
app.get('/video-status/:operationId(*)', async (req, res) => {
  // O operationId vem no formato "projects/../locations/../operations/.."
  // O SDK precisa do nome completo, que é o que passamos na URL.
  const operationName = req.params.operationId;

  if (!operationName) {
    return res.status(400).send({ error: 'O ID da operação é obrigatório.' });
  }

  try {
    // Acessa o serviço de operações para obter o status
    const [operation] = await vertexAi.operationsClient.getOperation({ name: operationName });

    if (!operation.done) {
      // O vídeo ainda está sendo processado
      console.log(`Operação ${operationName} ainda em andamento...`);
      res.status(200).send({ status: 'PROCESSING', message: 'O vídeo ainda está sendo gerado.' });
    } else {
      // O processo terminou. Verificamos se houve erro ou sucesso.
      if (operation.error) {
        console.error(`Operação ${operationName} falhou:`, operation.error);
        res.status(500).send({ status: 'FAILED', error: 'A geração do vídeo falhou.', details: operation.error });
      } else {
        console.log(`Operação ${operationName} concluída com sucesso.`);
        // Extrai a URL do vídeo do resultado da operação
        const fileUri = operation.response?.candidates?.[0]?.content?.parts?.[0]?.fileData?.fileUri;

        if (fileUri) {
          // IMPORTANTE: fileUri é um link 'gs://...'. Para usá-lo na web,
          // você precisa torná-lo público ou gerar uma Signed URL.
          // Por simplicidade, retornamos o link 'gs://' e a URL pública presumida.
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
 * Rota de Health Check para verificar se o servidor está no ar.
 */
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
