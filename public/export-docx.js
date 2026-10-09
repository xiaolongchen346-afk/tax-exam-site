(function () {
  "use strict";

  const REASON_LABELS = {
    concept: "概念不清",
    calculation: "计算失误",
    reading: "审题遗漏",
    memory: "记忆模糊",
    method: "方法不熟",
    other: "其他原因",
  };

  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function run(value, options) {
    const opts = options || {};
    const props = [
      '<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>',
      opts.bold ? "<w:b/>" : "",
      opts.italic ? "<w:i/>" : "",
      opts.color ? `<w:color w:val="${opts.color}"/>` : "",
      opts.size ? `<w:sz w:val="${opts.size}"/>` : "",
      opts.size ? `<w:szCs w:val="${opts.size}"/>` : "",
    ].join("");

    const parts = String(value ?? "").split("\n");
    const text = parts
      .map((part, index) => {
        const prefix = index ? '<w:br w:type="textWrapping"/>' : "";
        return `${prefix}<w:t xml:space="preserve">${xmlEscape(part)}</w:t>`;
      })
      .join("");
    return `<w:r><w:rPr>${props}</w:rPr>${text}</w:r>`;
  }

  function paragraph(value, options) {
    const opts = options || {};
    const paragraphProps = [
      opts.align ? `<w:jc w:val="${opts.align}"/>` : "",
      opts.spacingBefore || opts.spacingAfter
        ? `<w:spacing w:before="${opts.spacingBefore || 0}" w:after="${opts.spacingAfter || 0}" w:line="300" w:lineRule="auto"/>`
        : '<w:spacing w:after="90" w:line="300" w:lineRule="auto"/>',
      opts.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shading}"/>` : "",
      opts.indentLeft ? `<w:ind w:left="${opts.indentLeft}"/>` : "",
      opts.border
        ? '<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="C6D5DB"/></w:pBdr>'
        : "",
    ].join("");

    return `<w:p><w:pPr>${paragraphProps}</w:pPr>${run(value, opts)}</w:p>`;
  }

  function pageBreak() {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  function answerLetters(question, record) {
    const selected = record && Array.isArray(record.lastAnswer) ? record.lastAnswer : [];
    const correct = Array.isArray(question.answer) ? question.answer : [];
    return {
      selected: selected.length ? selected.join("") : "未作答",
      correct: correct.length ? correct.join("") : question.answerText || "参考答案",
    };
  }

  function questionParagraphs(question, record, index, total) {
    const result = answerLetters(question, record);
    const subject = question.subjectName || question.subjectId;
    const chapter = question.chapterName || question.chapterId;
    const reason = record && record.reason ? REASON_LABELS[record.reason] || record.reason : "未标注";
    const note = record && record.note ? record.note : "无";
    const wrongCount = record && record.wrongCount ? record.wrongCount : 1;

    const paragraphs = [
      paragraph(`第 ${index + 1} / ${total} 题　${question.typeLabel || "题目"}`, {
        bold: true,
        color: "1F5B87",
        size: 28,
        spacingBefore: index ? 300 : 0,
        spacingAfter: 80,
      }),
      paragraph(`${subject} · ${chapter} · 原题号 ${question.number}`, {
        color: "667983",
        size: 19,
        spacingAfter: 140,
      }),
      paragraph(question.prompt, { bold: true, size: 22, spacingAfter: 140 }),
    ];

    if (question.options && question.options.length) {
      question.options.forEach((option) => {
        paragraphs.push(
          paragraph(`${option.key}. ${option.text}`, {
            indentLeft: 280,
            size: 21,
            spacingAfter: 70,
          }),
        );
      });
    }

    paragraphs.push(
      paragraph(`我的答案：${result.selected}　|　正确答案：${result.correct}`, {
        bold: true,
        color: result.selected === result.correct ? "187455" : "B94436",
        shading: result.selected === result.correct ? "E8F6F0" : "FBEBE8",
        size: 21,
        spacingBefore: 120,
        spacingAfter: 100,
      }),
    );

    if (question.options.length === 0 && question.answerText) {
      paragraphs.push(
        paragraph(`参考答案\n${question.answerText}`, {
          color: "187455",
          size: 20,
          spacingBefore: 80,
          spacingAfter: 100,
        }),
      );
    }

    paragraphs.push(
      paragraph(`错因：${reason}　|　累计错 ${wrongCount} 次`, {
        color: "6D5B93",
        size: 20,
        spacingBefore: 100,
        spacingAfter: 80,
      }),
      paragraph(`我的笔记：${note}`, {
        color: "667983",
        size: 20,
        spacingAfter: 100,
      }),
    );

    if (question.explanation) {
      paragraphs.push(
        paragraph(`解析\n${question.explanation}`, {
          border: true,
          size: 20,
          spacingBefore: 120,
          spacingAfter: 120,
        }),
      );
    }

    return paragraphs.join("");
  }

  function buildDocumentXml(items, records, meta) {
    const total = items.length;
    const now = new Date();
    const dateText = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);

    const intro = [
      paragraph(meta.title || "税务师错题导出", {
        align: "center",
        bold: true,
        color: "1F5B87",
        size: 36,
        spacingAfter: 160,
      }),
      paragraph(`生成时间：${dateText}`, {
        align: "center",
        color: "667983",
        size: 20,
        spacingAfter: 80,
      }),
      paragraph(`范围：${meta.scopeLabel || "全部错题"}`, {
        align: "center",
        color: "667983",
        size: 20,
        spacingAfter: 80,
      }),
      paragraph(`共 ${total} 题`, {
        align: "center",
        bold: true,
        color: "17242C",
        size: 24,
        spacingAfter: 220,
      }),
    ].join("");

    const body = items
      .map((question, index) => {
        const prefix = index === 0 ? pageBreak() : pageBreak();
        return prefix + questionParagraphs(question, records[question.id], index, total);
      })
      .join("");

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" +
      intro +
      body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>"
    );
  }

  function buildStylesXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="90" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      "</w:styles>"
    );
  }

  function buildContentTypesXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>"
    );
  }

  function buildRootRelationshipsXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>"
    );
  }

  function buildDocumentRelationshipsXml() {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>"
    );
  }

  function buildCorePropertiesXml(meta) {
    const now = new Date().toISOString();
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xmlEscape(meta.title || "税务师错题导出")}</dc:title>` +
      "<dc:creator>税务师智能题库</dc:creator>" +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      "</cp:coreProperties>"
    );
  }

  async function buildDocxData(items, records, meta) {
    if (!window.JSZip) {
      throw new Error("Word 导出组件未加载");
    }
    if (!items.length) {
      throw new Error("当前范围没有可导出的错题");
    }

    const zip = new window.JSZip();
    zip.file("[Content_Types].xml", buildContentTypesXml());
    zip.folder("_rels").file(".rels", buildRootRelationshipsXml());
    zip.folder("docProps").file("core.xml", buildCorePropertiesXml(meta));
    zip.folder("word").file("document.xml", buildDocumentXml(items, records, meta));
    zip.folder("word").file("styles.xml", buildStylesXml());
    zip
      .folder("word")
      .folder("_rels")
      .file("document.xml.rels", buildDocumentRelationshipsXml());

    return zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  }

  function safeFilename(value) {
    return String(value || "错题导出")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
  }

  async function downloadDocx(items, records, meta) {
    const data = await buildDocxData(items, records || {}, meta || {});
    const blob = new Blob([data], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const date = new Date();
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("");
    const filename = `${safeFilename(meta && meta.filenamePrefix)}_${stamp}.docx`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  }

  window.TaxExamExport = {
    REASON_LABELS,
    buildDocxData,
    downloadDocx,
  };
})();
