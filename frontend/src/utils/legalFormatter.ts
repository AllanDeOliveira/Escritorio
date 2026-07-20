/**
 * legalFormatter.ts
 * Utilitários para formatação de documentos jurídicos seguindo padrões rigorosos de peticionamento.
 */

export interface StyleConfig {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  color: string;
  backgroundColor: string;
  marginPage: string;
  maxWidth: string;
  indent: string;
  heading: {
    1: any;
    2: any;
    3: any;
  };
  citation: any;
}

/**
 * 1. styleConfig()
 * Retorna o objeto com toda a configuração de estilos centralizada.
 */
export function styleConfig(): StyleConfig {
  return {
    fontFamily: '"Times New Roman", Times, serif',
    fontSize: '12pt',
    lineHeight: '1.5',
    color: '#000000',
    backgroundColor: '#ffffff',
    marginPage: '2.54cm 3.17cm 1.9cm 3.17cm', // Top Right Bottom Left
    maxWidth: '21cm',
    indent: '1.27cm',
    heading: {
      1: {
        fontWeight: 'bold',
        textTransform: 'uppercase' as const,
        marginTop: '24pt',
        marginBottom: '12pt',
        textAlign: 'center' as const,
      },
      2: {
        fontWeight: 'bold',
        textTransform: 'uppercase' as const,
        marginTop: '18pt',
        marginBottom: '6pt',
        textAlign: 'justify' as const,
      },
      3: {
        fontWeight: 'bold',
        textTransform: 'uppercase' as const,
        marginTop: '12pt',
        marginBottom: '6pt',
        textAlign: 'justify' as const,
      }
    },
    citation: {
      marginLeft: '1.27cm',
      marginRight: '1.27cm',
      marginTop: '12pt',
      marginBottom: '12pt',
      textAlign: 'justify' as const,
      fontSize: '12pt',
      lineHeight: '1.5',
    }
  };
}

// Contadores para numeração automática
let countL1 = 0;
let countL2 = 0;
let countL3 = 0; // Para 'a]', 'b]'...

/**
 * 2. applyHeadingStyle(level, text)
 * Aplica estilos e numeração automática a títulos.
 */
export function applyHeadingStyle(level: 1 | 2 | 3, text: string): string {
  const styles = styleConfig().heading[level];
  let prefix = '';

  if (level === 1) {
    countL1++;
    countL2 = 0; // Reseta subnível
    prefix = `${countL1} - `;
  } else if (level === 2) {
    countL2++;
    prefix = `${countL1}.${countL2} - `;
  } else if (level === 3) {
    // Converte countL3 para letra (0 -> a, 1 -> b)
    const letter = String.fromCharCode(97 + countL3);
    countL3++;
    prefix = `${letter}] `;
  }

  const styleStr = Object.entries(styles)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${v}`)
    .join('; ');

  const content = (prefix + text).toUpperCase();

  return `<p style="${styleStr}; margin: 0; line-height: 1.0;"><strong>${content}:</strong></p>`;
}

/**
 * 3. applyBodyParagraph(text)
 * Formata um parágrafo padrão com recuo de primeira linha.
 */
export function applyBodyParagraph(text: string): string {
  const config = styleConfig();
  return `<p style="text-indent: ${config.indent}; text-align: justify; margin: 0; line-height: ${config.lineHeight}; font-size: ${config.fontSize}; font-family: ${config.fontFamily};">${text}</p>`;
}

/**
 * 4. applyCitationStyle(text, isJurisprudence = false)
 * Formata citações de lei ou jurisprudência com recuo duplo.
 */
export function applyCitationStyle(text: string, isJurisprudence: boolean = false): string {
  const styles = styleConfig().citation;
  const styleStr = Object.entries(styles)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${v}`)
    .join('; ');

  let content = text;

  if (isJurisprudence) {
    // Primeira linha em negrito
    const lines = text.split('\n');
    if (lines.length > 0) {
      lines[0] = `<strong>${lines[0]}</strong>`;
    }
    
    // Numeração de pontos [1], [2]...
    // Procuramos por padrões como [1], [2] e garantimos que fiquem no texto
    // (A IA já deve prover estes marcadores)
    content = lines.join('<br>');
  }

  return `<div style="${styleStr}">${content}</div>`;
}

/**
 * 5. generateDocumentWrapper(content)
 * Envolve o conteúdo HTML nas configurações globais de página A4.
 */
export function generateDocumentWrapper(content: string): string {
  const config = styleConfig();
  return `
<div style="font-family: ${config.fontFamily}; font-size: ${config.fontSize}; line-height: ${config.lineHeight}; 
            text-align: justify; max-width: ${config.maxWidth}; margin: ${config.marginPage}; color: ${config.color}; 
            background-color: ${config.backgroundColor}; padding: 0;">
  ${content}
</div>`.trim();
}

/**
 * 6. formatDocument(sections)
 * Processa um array de seções gerando o HTML finalizado.
 */
export function formatDocument(sections: any[]): string {
  // Resetar contadores ao iniciar novo documento
  countL1 = 0;
  countL2 = 0;
  countL3 = 0;

  let htmlResult = '';

  // Header estilizado conforme análise
  const brandColor = '#1A233A';
  htmlResult += `
    <div style="background-color: ${brandColor}; color: white; padding: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center;">
      <div style="font-size: 18pt; font-weight: bold;">JESUS VIEIRA DE OLIVEIRA</div>
      <div style="font-size: 10pt; text-align: right;">Sociedade Individual de Advocacia</div>
    </div>
  `;

  sections.forEach(section => {
    switch (section.type) {
      case 'heading':
        htmlResult += applyHeadingStyle(section.level, section.content) + '\n';
        break;
      case 'paragraph':
        htmlResult += applyBodyParagraph(section.content) + '\n';
        break;
      case 'citation':
        htmlResult += applyCitationStyle(section.content, !!section.isJurisprudence) + '\n';
        break;
      case 'jurisprudence':
        htmlResult += applyCitationStyle(section.content, true) + '\n';
        break;
      case 'closing':
        htmlResult += `
<p style="text-indent: 1.27cm; text-align: justify; margin: 0; margin-top: 1cm;">Pelo exposto, requer...</p>
<p style="text-indent: 1.27cm; text-align: justify; margin: 0; margin-top: 0.5cm;">Termos em que pede deferimento.</p>
<p style="text-align: right; margin-top: 1cm;">${section.location || 'Cáceres/MT'}, ${section.date || new Date().toLocaleDateString('pt-BR')}.</p>
<div style="display: flex; justify-content: space-around; margin-top: 3cm;">
  <div style="text-align: center; border-top: 1px solid #000; width: 200px; padding-top: 5px;">
    <strong>JESUS VIEIRA DE OLIVEIRA</strong><br>
    OAB/MT 12.345
  </div>
</div>`.trim() + '\n';
        break;
      default:
        if (section.content) htmlResult += applyBodyParagraph(section.content) + '\n';
    }
  });

  // Footer estilizado conforme análise
  htmlResult += `
    <div style="background-color: ${brandColor}; color: white; padding: 10px; margin-top: 40px; font-size: 9pt; border-top: 1px solid white;">
      contato@advocacia.com.br • (65) 99999-9999 • Rua dos Advogados, 123, Centro, Cáceres/MT
    </div>
  `;

  return generateDocumentWrapper(htmlResult);
}

/**
 * 7. validateDocumentFormatting(html)
 * Valida se o HTML gerado atende aos requisitos técnicos.
 */
export function validateDocumentFormatting(html: string) {
  const checks = {
    hasBoldHeadings: html.includes('<strong>') && html.includes('upper-case'),
    hasProperIndentation: html.includes('text-indent: 0.5cm'),
    hasJustification: html.includes('text-align: justify'),
    hasCitations: html.includes('margin-left: 1cm'),
    hasProperMargins: html.includes('margin: 2.54cm'),
    hasCorrectFontSize: html.includes('font-size: 12pt'),
  };

  const warnings: string[] = [];
  const errors: string[] = [];
  
  if (!checks.hasJustification) errors.push('O documento não possui alinhamento justificado.');
  if (!checks.hasProperMargins) errors.push('As margens da página não estão configuradas como 2.54cm.');

  return {
    isValid: errors.length === 0,
    checks,
    warnings,
    errors
  };
}

/**
 * 8. downloadDocument(html, filename, format = 'html')
 * Dispara o download do documento no formato solicitado.
 */
export async function downloadDocument(html: string, filename: string, format: 'html' | 'pdf' | 'docx' = 'html') {
  if (format === 'html') {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.html`;
    a.click();
    return;
  }
  
  // Para PDF e DOCX em ambiente React puro, geralmente delegamos ao backend
  // ou usamos bibliotecas como html2pdf.js ou docx
  console.log(`Iniciando download em formato ${format} para ${filename}`);

  if (format === 'docx' || format === 'pdf') {
      // Exemplo de integração: Chamaria a rota do backend que já implementamos
      // No contexto real desta aplicação, o download já é feito pelo App.tsx chamando o backend.
      // Aqui apenas simulo ou descrevo o comportamento conforme solicitado.
      alert(`Para baixar em ${format}, utilize a função de exportação do painel de resultados.`);
  }
}
