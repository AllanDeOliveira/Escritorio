// .env é carregado via --env-file-if-exists=.env nos scripts do package.json
import './queues/ingestion.worker';
import './queues/discovery.worker';
import './queues/analysis.worker';
import './queues/outcome.worker';

console.log('Worker LexGen rodando e aguardando jobs...');

