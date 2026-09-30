/* Shared Student-format PRC preview and DOCX generator for every role. */
window.PrcExport = {
  create({ escapeHtml, normalizeProcedureKey, PhilippineTime, getStudent }) {
    const procedureNames = {};
      const PRC_DIAGNOSIS_HEADERS = {
        "delivery-handled": "Complete Diagnosis(Gravida, Para)",
        "delivery-assisted": "Complete Diagnosis(Gravida, Para)",
        suturing: "Complete Diagnosis",
        "iv-insertion": "Complete Diagnosis",
        "internal-exam": "Internal Examination (Cervical Dilation, Effacement, BOW, Presentation and Station)",
      };
      const PRC_FORM_TITLES = {
        "delivery-handled": "Record of Normal Deliveries Handled",
        "delivery-assisted": "Record of Delivery Assisted",
        suturing: "Record of Actual Suturing of Perineal Lacerations",
        "iv-insertion": "Record of Actual Intravenous Fluid Insertions",
        "internal-exam": "Record of Actual Internal Examination",
      };
      function getPrcDiagnosisHeader(procedureKey) {
        return PRC_DIAGNOSIS_HEADERS[procedureKey] || "Complete Diagnosis";
      }
      const PROCEDURE_TARGETS = {
        "delivery-handled": 20,
        "delivery-assisted": 20,
        suturing: 5,
        "iv-insertion": 5,
        "internal-exam": 20,
      };
      const PRC_PREVIEW_PROCEDURE_ORDER = [
        "delivery-handled",
        "delivery-assisted",
        "suturing",
        "iv-insertion",
        "internal-exam",
      ];
      const PRC_EXPORT_PAGE_LAYOUT = PRC_PREVIEW_PROCEDURE_ORDER.flatMap((procedureKey) => {
        const requiredCases = PROCEDURE_TARGETS[procedureKey] || 0;
        const pageSize = 10;
        const pageCount = Math.ceil(requiredCases / pageSize);
        return Array.from({ length: pageCount }, (_, pageIndex) => ({
          procedureKey,
          pageIndex,
          startIndex: pageIndex * pageSize,
          rowCount: Math.min(pageSize, requiredCases - pageIndex * pageSize),
          isFinalPage: pageIndex === pageCount - 1,
        }));
      });
      const PRC_EXPORT_TABLE_COLUMNS = [17, 7, 20, 9, 13, 10, 8, 6, 10];
      const PRC_DOCX_PAGE_WIDTH = 18720;
      const PRC_DOCX_PAGE_HEIGHT = 12240;
      const PRC_DOCX_MARGIN = 432;
      const PRC_DOCX_CONTENT_WIDTH = PRC_DOCX_PAGE_WIDTH - (PRC_DOCX_MARGIN * 2);
      const PRC_FOOTER_COPY = {
        noteOne: "(1) The Clinical Instructor should ensure competence of the students in the performance of actual deliveries before signing this form.",
        noteTwo: "(2) Registered Midwives/ Clinical Instructors who supervise Students/ Graduate Midwives/ Registered Nurses and affix signature in this Form must present a Certificate of Training on Expanded Functions of Midwife (R.A. 7392) pursuant to Board Resolution No. 07, Series of 2017, dated September 8, 2017.",
        licenseNumber: "RN-0508249/RM-0174915",
        expiryLine: "______________",
      };

      function formatPrcExportDateTime(value) {
        if (!value) return "";
        const date = PhilippineTime.parse(value, true);
        if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
        return `${date.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "2-digit", year: "numeric" })}<br>${date.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}`;
      }

      function formatPrcExportDate(value) {
        if (!value || /^0{4}-0{2}-0{2}$/.test(String(value))) return "";
        const date = PhilippineTime.parse(String(value).slice(0, 10), true);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "2-digit", year: "numeric" });
      }

      function prcExportCell(...values) {
        const lines = values
          .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
          .map((value) => escapeHtml(value).replace(/\r?\n/g, "<br>"));
        return lines.length ? lines.join("<br>") : "&nbsp;";
      }

      function getPrcExportRecordsByProcedure(records) {
        return PRC_PREVIEW_PROCEDURE_ORDER.reduce((groupedRecords, procedureKey) => {
          groupedRecords[procedureKey] = (Array.isArray(records) ? records : [])
            .filter((record) => normalizeProcedureKey(record.procedure_key || record.procedure_name || record.procedureKey || record.procedureName) === procedureKey)
            .slice(0, PROCEDURE_TARGETS[procedureKey] || 0);
          return groupedRecords;
        }, {});
      }

      function getPrcExportRecordValues(record, rowNumber) {
        const patient = [record?.patient_name, record?.patient_address]
          .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
          .map((value) => String(value))
          .join("\n");
        if (!record) return [String(rowNumber), "", "", "", "", "", "", "", ""];
        return [
          patient ? `${rowNumber}. ${patient}` : String(rowNumber),
          record.case_no || "",
          record.complete_diagnosis || "",
          formatPrcDocxDateTime(record.date_time_performed),
          [record.facility_name, record.facility_address, record.facility_contact_number]
            .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
            .join("\n"),
          [record.supervisor_printed_name, record.supervisor_contact_number]
            .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
            .join("\n"),
          record.supervisor_position_designation || "",
          "",
          [record.supervisor_license_no, formatPrcDocxDate(record.supervisor_license_expiry_date)]
            .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
            .join("\n"),
        ];
      }

      function buildPrcExportTable(procedureKey, records, startIndex = 0, rowCount = PROCEDURE_TARGETS[procedureKey] || 5) {
        const geometry = {
          "delivery-handled": { width: 100, columns: PRC_EXPORT_TABLE_COLUMNS },
          "delivery-assisted": { width: 100, columns: PRC_EXPORT_TABLE_COLUMNS },
          suturing: { width: 100, columns: PRC_EXPORT_TABLE_COLUMNS },
          "iv-insertion": { width: 100, columns: PRC_EXPORT_TABLE_COLUMNS },
          "internal-exam": { width: 100, columns: PRC_EXPORT_TABLE_COLUMNS },
        }[procedureKey] || { width: 100, columns: PRC_EXPORT_TABLE_COLUMNS };
        const pageRecords = records.slice(startIndex, startIndex + rowCount);
        const rows = pageRecords.map((record, rowIndex) => {
          const values = getPrcExportRecordValues(record, startIndex + rowIndex + 1);
          return `<tr>${values.map((value) => `<td>${prcExportCell(value)}</td>`).join("")}</tr>`;
        }).join("");
        const blankRows = Math.max(0, rowCount - pageRecords.length);
        const emptyRows = Array.from({ length: blankRows }, (_, rowIndex) => {
          const values = getPrcExportRecordValues(null, startIndex + pageRecords.length + rowIndex + 1);
          return `<tr class="prc-export-blank-row">${values.map((value) => `<td>${prcExportCell(value)}</td>`).join("")}</tr>`;
        }).join("");
        return `<table class="prc-export-table" style="width:${geometry.width}%">
          <colgroup>${geometry.columns.map((width) => `<col style="width:${width}%">`).join("")}</colgroup>
          <thead><tr><th rowspan="2">Name and Address of Patient</th><th rowspan="2">Case<br>No.</th><th rowspan="2">${getPrcDiagnosisHeader(procedureKey)}</th><th rowspan="2">Date &amp; Time<br>Performed</th><th rowspan="2">Full Name, Address of<br>Facility &amp; Contact Number</th><th colspan="4">Supervised by</th></tr><tr><th>Printed Name and<br>Contact No.</th><th>Position/<br>Designation</th><th>Signature</th><th>License No /<br>Expiry Date</th></tr></thead>
          <tbody>${rows}${emptyRows}</tbody>
        </table>`;
      }

      let prcLogoDataUrl = "";

      async function getPrcLogoDataUrl() {
        if (prcLogoDataUrl) return prcLogoDataUrl;
        const logoPath = "assets/images/prc-form-image1.jpeg";
        try {
          const response = await fetch(logoPath);
          if (!response.ok) throw new Error("PRC logo could not be loaded.");
          const logoBlob = await response.blob();
          prcLogoDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(logoBlob);
          });
        } catch (error) {
          prcLogoDataUrl = logoPath;
        }
        return prcLogoDataUrl;
      }

      function buildPrcExportFooter() {
        return `<div class="prc-export-footer">
          <div class="prc-export-notes">
            <strong class="prc-export-note-label">Note:</strong>
            <div class="prc-export-note-copy">
              <p><strong>${PRC_FOOTER_COPY.noteOne}</strong></p>
              <p><strong>${PRC_FOOTER_COPY.noteTwo}</strong></p>
            </div>
          </div>
          <div class="prc-export-affidavit">
            <p><strong>SUBSCRIBED AND SWORN TO</strong> before me this <span class="prc-export-fill-line prc-export-affidavit-line"></span> at <span class="prc-export-fill-line prc-export-affidavit-line"></span>. Affiant exhibiting to me his/her</p>
            <p class="prc-export-residence">Residence Certificate No. <span class="prc-export-fill-line prc-export-residence-number"></span> issued at <span class="prc-export-fill-line prc-export-residence-place"></span> on <span class="prc-export-fill-line prc-export-residence-date"></span>.</p>
          </div>
          <div class="prc-export-certification-title"><strong>CERTIFIED CORRECT:</strong></div>
          <div class="prc-export-footer-grid">
            <div class="prc-export-notary">
              <span class="prc-export-notary-line"></span>
              <strong>Administering Officer/Notary Public</strong>
            </div>
            <div class="prc-export-stamp">
              <span>Affix</span>
              <span>Documentary Stamp</span>
              <small>To be posted on the last page</small>
            </div>
            <div class="prc-export-certified-details">
              <div class="prc-export-cert-row"><span>Signature:</span><span class="prc-export-fill-line"></span><span>Date:</span><span class="prc-export-fill-line prc-export-date-line"></span></div>
              <div class="prc-export-cert-row prc-export-cert-row-simple"><span>Printed Name:</span><span class="prc-export-fill-line"></span></div>
              <div class="prc-export-cert-row prc-export-cert-row-simple"><span>Designation:</span><span class="prc-export-fill-line"></span></div>
              <div class="prc-export-license-row">License Number: <strong>${PRC_FOOTER_COPY.licenseNumber}</strong> Expiry Date: <span class="prc-export-fill-line prc-export-expiry-line"></span></div>
            </div>
          </div>
        </div>`;
      }

      function buildPrcExportForms(records, logoSource, exportStudent = getStudent()) {
        const studentName = exportStudent.student_name || exportStudent.name || "";
        const school = exportStudent.school_name || exportStudent.school || "BOHOL ISLAND STATE UNIVERSITY CALAPE";
        const recordsByProcedure = getPrcExportRecordsByProcedure(records);
        return PRC_EXPORT_PAGE_LAYOUT.map(({ procedureKey, pageIndex, startIndex, rowCount, isFinalPage }) => {
          const isContinuation = pageIndex > 0;
          return `<section class="prc-export-form${isContinuation ? " prc-export-continuation" : ""}">
            ${isContinuation ? "" : `
            <div class="prc-export-heading">
              <img class="prc-export-logo" src="${logoSource}" alt="Professional Regulation Commission seal">
              <div class="prc-export-heading-text">
                <div class="prc-export-agency">PROFESSIONAL REGULATION COMMISSION</div>
                <div class="prc-export-city">Cebu City</div>
                <div class="prc-export-board">BOARD OF MIDWIFERY</div>
              </div>
            </div>
            <h1>${PRC_FORM_TITLES[procedureKey] || procedureNames[procedureKey]}</h1>
            <p class="prc-export-check-label">Please check if applicant is:</p>
            <p class="prc-export-check-options"><span class="prc-check-box is-checked">&#10003;</span> Graduate Midwife <span class="prc-check-box"></span> Registered Nurse</p>
            <p class="prc-export-applicant"><span>Name of Applicant:</span><span class="prc-export-line">${escapeHtml(studentName)}</span><span class="prc-export-school-label">School:</span><span class="prc-export-line prc-export-school">${escapeHtml(school)}</span></p>`}
            ${buildPrcExportTable(procedureKey, recordsByProcedure[procedureKey] || [], startIndex, rowCount)}
            ${isFinalPage ? buildPrcExportFooter() : `<div class="prc-export-continued">(continued next page)</div>`}
          </section>`;
        }).join("");
      }

      function buildPrcWordDocument(forms) {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
          @page Section1 { size: 936pt 612pt; mso-page-orientation: landscape; margin: 25.2pt 25.2pt 25.2pt 25.2pt; }
          div.Section1 { page: Section1; }
          body { margin: 0; color: #000; background: #fff; font-family: Cambria, "Times New Roman", serif; font-size: 10pt; }
          .prc-export-form { padding-top: 57pt; page-break-after: always; }
          .prc-export-form:last-child { page-break-after: auto; }
          .prc-export-heading { position: relative; min-height: 44pt; margin: 0; }
          .prc-export-logo { position: absolute; left: 150pt; top: 0; width: 58pt; height: 58pt; object-fit: contain; }
          .prc-export-heading-text { padding-top: 7pt; text-align: center; }
          .prc-export-agency, .prc-export-city, .prc-export-board, .prc-export-form h1 { text-align: center; margin: 0; }
          .prc-export-agency { font-size: 10pt; font-weight: 400; }
          .prc-export-city, .prc-export-board { font-size: 9pt; font-weight: 400; }
          .prc-export-board { font-weight: 700; }
          .prc-export-form h1 { margin: 2pt 0 0; font-size: 14pt; font-weight: 700; }
          .prc-export-check { margin: 0 0 13pt; text-align: right; font-size: 10pt; }
          .prc-check-box { display: inline-block; width: 21pt; height: 16pt; margin: 0 5pt 0 11pt; border: 1px solid #000; text-align: center; line-height: 15pt; vertical-align: middle; }
          .prc-export-applicant { margin: 0 0 10pt; font-size: 10pt; }
          .prc-export-line { display: inline-block; min-width: 255pt; border-bottom: 1px solid #000; font-weight: 700; }
          .prc-export-school-label { margin-left: 72pt; }
          .prc-export-school { min-width: 205pt; }
          .prc-export-table { width: 100%; border: 1px solid #000; border-collapse: collapse; border-spacing: 0; table-layout: fixed; color: #000; background: #fff; }
          .prc-export-table th, .prc-export-table td { border: 1px solid #000; padding: 2pt 3pt; color: #000; background: #fff; text-align: center; text-transform: uppercase; vertical-align: middle; overflow-wrap: anywhere; word-break: break-word; }
          .prc-export-table th { padding: 1pt 2pt; font-family: Cambria, "Times New Roman", serif; font-size: 8pt; font-weight: 700; line-height: 1; }
          .prc-export-table td { height: 22pt; font-family: Cambria, "Times New Roman", serif; font-size: 8pt; font-weight: 400; line-height: 1.1; }
          .prc-export-table td:nth-child(3) { font-size: 6pt; }
        </style></head><body><div class="Section1">${forms}</div></body></html>`;
      }

      const PRC_TEMPLATE_URL = "assets/templates/prc-forms-template.docx";
      const PRC_WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
      const PRC_XML_NS = "http://www.w3.org/XML/1998/namespace";
      const PRC_CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let index = 0; index < 256; index += 1) {
          let value = index;
          for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
          table[index] = value >>> 0;
        }
        return table;
      })();

      function prcCrc32(bytes) {
        let crc = 0xffffffff;
        for (let index = 0; index < bytes.length; index += 1) crc = PRC_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
      }

      function prcZipU16(view, offset) { return view.getUint16(offset, true); }
      function prcZipU32(view, offset) { return view.getUint32(offset, true); }

      async function prcInflate(bytes, compression) {
        if (compression === 0) return bytes;
        if (compression !== 8 || typeof DecompressionStream === "undefined") throw new Error("This browser cannot read the PRC document template.");
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }

      async function readPrcTemplateZip(arrayBuffer) {
        const source = new Uint8Array(arrayBuffer);
        const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
        let endOffset = -1;
        for (let offset = Math.max(0, source.length - 65557); offset <= source.length - 22; offset += 1) {
          if (prcZipU32(view, offset) === 0x06054b50) endOffset = offset;
        }
        if (endOffset < 0) throw new Error("The PRC template is not a valid DOCX file.");
        const count = prcZipU16(view, endOffset + 10);
        let offset = prcZipU32(view, endOffset + 16);
        const decoder = new TextDecoder();
        const entries = [];
        for (let index = 0; index < count; index += 1) {
          if (prcZipU32(view, offset) !== 0x02014b50) throw new Error("The PRC template directory is invalid.");
          const compression = prcZipU16(view, offset + 10);
          const compressedSize = prcZipU32(view, offset + 20);
          const nameLength = prcZipU16(view, offset + 28);
          const extraLength = prcZipU16(view, offset + 30);
          const commentLength = prcZipU16(view, offset + 32);
          const localOffset = prcZipU32(view, offset + 42);
          const name = decoder.decode(source.slice(offset + 46, offset + 46 + nameLength));
          const localNameLength = prcZipU16(view, localOffset + 26);
          const localExtraLength = prcZipU16(view, localOffset + 28);
          const compressed = source.slice(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
          entries.push({ name, data: await prcInflate(compressed, compression) });
          offset += 46 + nameLength + extraLength + commentLength;
        }
        return entries;
      }

      function createPrcDocxZip(entries) {
        const encoder = new TextEncoder();
        const chunks = [];
        const central = [];
        let offset = 0;
        entries.forEach((entry) => {
          const name = encoder.encode(entry.name);
          const data = entry.data;
          const crc = prcCrc32(data);
          const local = new Uint8Array(30 + name.length);
          const localView = new DataView(local.buffer);
          localView.setUint32(0, 0x04034b50, true);
          localView.setUint16(4, 20, true);
          localView.setUint16(6, 0x0800, true);
          localView.setUint16(8, 0, true);
          localView.setUint32(14, crc, true);
          localView.setUint32(18, data.length, true);
          localView.setUint32(22, data.length, true);
          localView.setUint16(26, name.length, true);
          local.set(name, 30);
          chunks.push(local, data);
          const directory = new Uint8Array(46 + name.length);
          const directoryView = new DataView(directory.buffer);
          directoryView.setUint32(0, 0x02014b50, true);
          directoryView.setUint16(4, 20, true);
          directoryView.setUint16(6, 20, true);
          directoryView.setUint16(8, 0x0800, true);
          directoryView.setUint16(10, 0, true);
          directoryView.setUint32(16, crc, true);
          directoryView.setUint32(20, data.length, true);
          directoryView.setUint32(24, data.length, true);
          directoryView.setUint16(28, name.length, true);
          directoryView.setUint32(42, offset, true);
          directory.set(name, 46);
          central.push(directory);
          offset += local.length + data.length;
        });

      document
        .getElementById("inputCaseNo")
        ?.addEventListener("input", scheduleCaseRoleAvailabilityCheck);

      document
        .getElementById("inputPatientName")
        ?.addEventListener("input", scheduleCaseRoleAvailabilityCheck);
        const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
        const end = new Uint8Array(22);
        const endView = new DataView(end.buffer);
        endView.setUint32(0, 0x06054b50, true);
        endView.setUint16(8, entries.length, true);
        endView.setUint16(10, entries.length, true);
        endView.setUint32(12, centralSize, true);
        endView.setUint32(16, offset, true);
        const result = new Uint8Array(offset + centralSize + end.length);
        let cursor = 0;
        [...chunks, ...central, end].forEach((chunk) => { result.set(chunk, cursor); cursor += chunk.length; });
        return result;
      }

      function prcWordText(node) {
        return Array.from(node.getElementsByTagNameNS(PRC_WORD_NS, "t")).map((item) => item.textContent || "").join("");
      }

      function prcEnsureWordChild(documentNode, parent, localName) {
        let child = Array.from(parent.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === localName);
        if (!child) {
          child = documentNode.createElementNS(PRC_WORD_NS, `w:${localName}`);
          parent.appendChild(child);
        }
        return child;
      }

      function setPrcTemplateLegalTableMargins(xml) {
        const section = xml.getElementsByTagNameNS(PRC_WORD_NS, "sectPr")[0];
        if (section) {
          const pageMargins = prcEnsureWordChild(xml, section, "pgMar");
          pageMargins.setAttributeNS(PRC_WORD_NS, "w:left", "720");
          pageMargins.setAttributeNS(PRC_WORD_NS, "w:right", "720");
        }
        const tableWidth = 17280; // 13in legal width minus 0.5in left and right margins.
        Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "tbl")).forEach((table) => {
          const tableProperties = prcEnsureWordChild(xml, table, "tblPr");
          const width = prcEnsureWordChild(xml, tableProperties, "tblW");
          width.setAttributeNS(PRC_WORD_NS, "w:w", String(tableWidth));
          width.setAttributeNS(PRC_WORD_NS, "w:type", "dxa");
          const layout = prcEnsureWordChild(xml, tableProperties, "tblLayout");
          layout.setAttributeNS(PRC_WORD_NS, "w:type", "fixed");
          const gridColumns = Array.from(table.getElementsByTagNameNS(PRC_WORD_NS, "gridCol"));
          const originalWidths = gridColumns.map((column) => Number(column.getAttributeNS(PRC_WORD_NS, "w")) || 0);
          const originalTotal = originalWidths.reduce((sum, value) => sum + value, 0);
          let usedWidth = 0;
          const scaledWidths = [];
          gridColumns.forEach((column, index) => {
            const nextWidth = index === gridColumns.length - 1
              ? tableWidth - usedWidth
              : Math.round((originalWidths[index] / originalTotal) * tableWidth);
            column.setAttributeNS(PRC_WORD_NS, "w:w", String(nextWidth));
            usedWidth += nextWidth;
            scaledWidths.push(nextWidth);
          });
          Array.from(table.children)
            .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tr")
            .forEach((row) => {
              let columnIndex = 0;
              Array.from(row.children)
                .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tc")
                .forEach((cell) => {
                  const cellProperties = prcEnsureWordChild(xml, cell, "tcPr");
                  const spanNode = Array.from(cellProperties.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "gridSpan");
                  const span = Math.max(1, Number(spanNode?.getAttributeNS(PRC_WORD_NS, "val")) || 1);
                  const cellWidth = prcEnsureWordChild(xml, cellProperties, "tcW");
                  cellWidth.setAttributeNS(PRC_WORD_NS, "w:w", String(scaledWidths.slice(columnIndex, columnIndex + span).reduce((sum, value) => sum + value, 0)));
                  cellWidth.setAttributeNS(PRC_WORD_NS, "w:type", "dxa");
                  columnIndex += span;
                });
            });
        });
      }

      function addDeliveryAssistedPrcSheet(xml) {
        const body = xml.getElementsByTagNameNS(PRC_WORD_NS, "body")[0];
        if (!body) return;
        const bodyChildren = Array.from(body.children);
        const normalTitle = bodyChildren.find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "p" && prcWordText(node).includes("Record of Normal"));
        const suturingTitle = bodyChildren.find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "p" && prcWordText(node).includes("Record of Actual Suturing"));
        if (!normalTitle || !suturingTitle) return;
        const normalTitleIndex = bodyChildren.indexOf(normalTitle);
        const suturingTitleIndex = bodyChildren.indexOf(suturingTitle);
        const findSheetStart = (titleIndex) => {
          for (let index = titleIndex; index >= 0; index -= 1) {
            const node = bodyChildren[index];
            if (node.namespaceURI === PRC_WORD_NS && node.localName === "p" && node.getElementsByTagNameNS(PRC_WORD_NS, "drawing").length) return index;
          }
          return titleIndex;
        };
        const startIndex = findSheetStart(normalTitleIndex);
        const endIndex = findSheetStart(suturingTitleIndex);
        if (endIndex <= startIndex) return;
        const copiedNodes = bodyChildren.slice(startIndex, endIndex).map((node) => node.cloneNode(true));
        const copiedTitle = copiedNodes.find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "p" && prcWordText(node).includes("Record of Normal"));
        if (copiedTitle) {
          const titleParts = Array.from(copiedTitle.getElementsByTagNameNS(PRC_WORD_NS, "t"));
          if (titleParts.length) titleParts[0].textContent = "Record of Delivery Assisted";
          titleParts.slice(1).forEach((part) => { part.textContent = ""; });
        }
        copiedNodes.forEach((node) => body.insertBefore(node, bodyChildren[endIndex]));
      }

      function setPrcTemplateColumnWidths(xml) {
        const columnShift = 520;
        Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "tbl")).forEach((table) => {
          const gridColumns = Array.from(table.getElementsByTagNameNS(PRC_WORD_NS, "gridCol"));
          const widths = gridColumns.map((column) => Number(column.getAttributeNS(PRC_WORD_NS, "w")) || 0);
          if (widths.length < 3 || widths.some((width) => width <= 0)) return;
          const tableProperties = prcEnsureWordChild(xml, table, "tblPr");
          const tableWidth = prcEnsureWordChild(xml, tableProperties, "tblW");
          tableWidth.setAttributeNS(PRC_WORD_NS, "w:w", String(PRC_DOCX_CONTENT_WIDTH));
          tableWidth.setAttributeNS(PRC_WORD_NS, "w:type", "dxa");
          const tableLayout = prcEnsureWordChild(xml, tableProperties, "tblLayout");
          tableLayout.setAttributeNS(PRC_WORD_NS, "w:type", "fixed");
          if (widths.length === PRC_EXPORT_TABLE_COLUMNS.length) {
            const totalWidth = PRC_DOCX_CONTENT_WIDTH;
            let usedWidth = 0;
            PRC_EXPORT_TABLE_COLUMNS.forEach((percentage, index) => {
              const nextWidth = index === PRC_EXPORT_TABLE_COLUMNS.length - 1
                ? totalWidth - usedWidth
                : Math.round((percentage / 100) * totalWidth);
              widths[index] = nextWidth;
              usedWidth += nextWidth;
            });
          } else {
            const shift = Math.min(columnShift, Math.max(0, widths[0] - 1));
            widths[0] -= shift;
            widths[2] += shift;
          }
          gridColumns.forEach((column, index) => column.setAttributeNS(PRC_WORD_NS, "w:w", String(widths[index])));
          Array.from(table.children)
            .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tr")
            .forEach((row) => {
              let columnIndex = 0;
              Array.from(row.children)
                .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tc")
                .forEach((cell) => {
                  const cellProperties = prcEnsureWordChild(xml, cell, "tcPr");
                  const spanNode = Array.from(cellProperties.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "gridSpan");
                  const span = Math.max(1, Number(spanNode?.getAttributeNS(PRC_WORD_NS, "val")) || 1);
                  const cellWidth = prcEnsureWordChild(xml, cellProperties, "tcW");
                  cellWidth.setAttributeNS(PRC_WORD_NS, "w:w", String(widths.slice(columnIndex, columnIndex + span).reduce((sum, value) => sum + value, 0)));
                  cellWidth.setAttributeNS(PRC_WORD_NS, "w:type", "dxa");
                  columnIndex += span;
                });
            });
        });
      }

      function setPrcTemplatePageLayout(xml) {
        const section = xml.getElementsByTagNameNS(PRC_WORD_NS, "sectPr")[0];
        if (section) {
          const pageMargins = prcEnsureWordChild(xml, section, "pgMar");
          pageMargins.setAttributeNS(PRC_WORD_NS, "w:top", "113");
          pageMargins.setAttributeNS(PRC_WORD_NS, "w:right", String(PRC_DOCX_MARGIN));
          pageMargins.setAttributeNS(PRC_WORD_NS, "w:bottom", String(PRC_DOCX_MARGIN));
          pageMargins.setAttributeNS(PRC_WORD_NS, "w:left", String(PRC_DOCX_MARGIN));
          const pageSize = prcEnsureWordChild(xml, section, "pgSz");
          pageSize.setAttributeNS(PRC_WORD_NS, "w:w", String(PRC_DOCX_PAGE_WIDTH));
          pageSize.setAttributeNS(PRC_WORD_NS, "w:h", String(PRC_DOCX_PAGE_HEIGHT));
          pageSize.setAttributeNS(PRC_WORD_NS, "w:orient", "landscape");
        }
        const body = xml.getElementsByTagNameNS(PRC_WORD_NS, "body")[0];
        if (!body) return;
        const isEmptyParagraph = (node) => node?.namespaceURI === PRC_WORD_NS && node.localName === "p" &&
          !Array.from(node.getElementsByTagNameNS(PRC_WORD_NS, "t"))
            .some((textNode) => String(textNode.textContent || "").replace(/[\s\u200B\uFEFF]/g, "")) &&
          !node.getElementsByTagNameNS(PRC_WORD_NS, "drawing").length;
        while (isEmptyParagraph(body.firstElementChild)) body.firstElementChild.remove();
        const logoParagraphs = Array.from(body.children).filter((node) =>
          node.namespaceURI === PRC_WORD_NS && node.localName === "p" &&
          Array.from(node.getElementsByTagNameNS(PRC_WORD_NS, "docPr")).some((drawing) => drawing.getAttribute("name") === "Picture 2"),
        );
        logoParagraphs.forEach((paragraph, index) => {
          let previous = paragraph.previousElementSibling;
          while (isEmptyParagraph(previous)) {
            const before = previous.previousElementSibling;
            previous.remove();
            previous = before;
          }
          if (index > 0) {
            const paragraphProperties = prcEnsureWordChild(xml, paragraph, "pPr");
            Array.from(paragraphProperties.children)
              .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "pageBreakBefore")
              .forEach((node) => node.remove());
            if (index === 1) {
              Array.from(paragraphProperties.children)
                .filter((node) => node.namespaceURI === PRC_WORD_NS && ["ind", "rPr"].includes(node.localName))
                .forEach((node) => node.remove());
            }
          }
        });
        normalizePrcContinuationLabels(xml);
        const tables = Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "tbl"));
        PRC_EXPORT_PAGE_LAYOUT.forEach((page, index) => {
          if (index === 0 || page.procedureKey !== PRC_EXPORT_PAGE_LAYOUT[index - 1].procedureKey) return;
          const table = tables[index];
          if (!table) return;
          const firstCell = table.getElementsByTagNameNS(PRC_WORD_NS, "tc")[0];
          const firstParagraph = firstCell?.getElementsByTagNameNS(PRC_WORD_NS, "p")[0];
          if (!firstParagraph) return;
          const paragraphProperties = prcEnsureWordChild(xml, firstParagraph, "pPr");
          Array.from(paragraphProperties.children)
            .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "pageBreakBefore")
            .forEach((node) => node.remove());
          // Start the continuation page with a 3 mm spacer outside the table.
          const spacer = xml.createElementNS(PRC_WORD_NS, "w:p");
          const spacerProperties = prcEnsureWordChild(xml, spacer, "pPr");
          const pageBreak = prcEnsureWordChild(xml, spacerProperties, "pageBreakBefore");
          pageBreak.setAttributeNS(PRC_WORD_NS, "w:val", "1");
          prcEnsureWordChild(xml, spacerProperties, "keepNext");
          const spacing = prcEnsureWordChild(xml, spacerProperties, "spacing");
          spacing.setAttributeNS(PRC_WORD_NS, "w:before", "0");
          spacing.setAttributeNS(PRC_WORD_NS, "w:after", "0");
          spacing.setAttributeNS(PRC_WORD_NS, "w:line", "170");
          spacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
          table.parentNode.insertBefore(spacer, table);
        });
      }

      function normalizePrcContinuationLabels(xml) {
        const body = xml.getElementsByTagNameNS(PRC_WORD_NS, "body")[0];
        if (!body) return;
        const isEmptyParagraph = (node) => node?.namespaceURI === PRC_WORD_NS && node.localName === "p" &&
          !prcWordText(node).trim() && !node.getElementsByTagNameNS(PRC_WORD_NS, "drawing").length;
        Array.from(body.children)
          .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "p" && /\(continued next page\)/i.test(prcWordText(node)))
          .forEach((paragraph) => {
            let previous = paragraph.previousElementSibling;
            while (isEmptyParagraph(previous)) {
              const before = previous.previousElementSibling;
              previous.remove();
              previous = before;
            }
            const table = Array.from(body.children)
              .slice(0, Array.from(body.children).indexOf(paragraph))
              .reverse()
              .find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tbl");
            if (table && paragraph.previousElementSibling !== table) body.insertBefore(paragraph, table.nextElementSibling);
            let next = paragraph.nextElementSibling;
            while (isEmptyParagraph(next)) {
              const after = next.nextElementSibling;
              next.remove();
              next = after;
            }
            const paragraphProperties = prcEnsureWordChild(xml, paragraph, "pPr");
            const spacing = prcEnsureWordChild(xml, paragraphProperties, "spacing");
            spacing.setAttributeNS(PRC_WORD_NS, "w:before", "0");
            spacing.setAttributeNS(PRC_WORD_NS, "w:after", "0");
            spacing.setAttributeNS(PRC_WORD_NS, "w:line", "180");
            spacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
            const indent = Array.from(paragraphProperties.children)
              .find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "ind");
            indent?.remove();
            const alignment = prcEnsureWordChild(xml, paragraphProperties, "jc");
            alignment.setAttributeNS(PRC_WORD_NS, "w:val", "right");
          });
      }

      function compactPrcTemplateHeaderSpacing(xml) {
        const body = xml.getElementsByTagNameNS(PRC_WORD_NS, "body")[0];
        if (!body) return;
        Array.from(body.children)
          .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "p")
          .forEach((paragraph) => {
            const text = prcWordText(paragraph).trim();
            if (!/^(?:PROFESSIONAL REGULATION COMMISSION|Cebu City|BOARD OF MIDWIFERY|Record of |Please check if applicant is:|Graduate Midwife|Name of Applicant:|\(continued next page\))/i.test(text)) return;
            const paragraphProperties = prcEnsureWordChild(xml, paragraph, "pPr");
            const spacing = prcEnsureWordChild(xml, paragraphProperties, "spacing");
            spacing.setAttributeNS(PRC_WORD_NS, "w:before", "0");
            spacing.setAttributeNS(PRC_WORD_NS, "w:after", "0");
            const lineHeight = /Record of /i.test(text) ? "360" : /(?:PROFESSIONAL REGULATION|Cebu City|BOARD OF MIDWIFERY|Please check|Graduate Midwife|Name of Applicant:)/i.test(text) ? "240" : "180";
            spacing.setAttributeNS(PRC_WORD_NS, "w:line", lineHeight);
            spacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
          });
      }

      function compactAssistedPrcHeader(xml) {
        const body = xml.getElementsByTagNameNS(PRC_WORD_NS, "body")[0];
        if (!body) return;
        const isEmptyParagraph = (node) => node?.namespaceURI === PRC_WORD_NS && node.localName === "p" &&
          !prcWordText(node).trim() && !node.getElementsByTagNameNS(PRC_WORD_NS, "drawing").length;
        const assistedTitle = Array.from(body.children).find((node) =>
          node.namespaceURI === PRC_WORD_NS && node.localName === "p" &&
          /Record of Delivery Assisted/i.test(prcWordText(node)),
        );
        let assistedLogo = assistedTitle?.previousElementSibling;
        while (assistedLogo && assistedLogo.localName === "p" &&
          !assistedLogo.getElementsByTagNameNS(PRC_WORD_NS, "drawing").length) {
          assistedLogo = assistedLogo.previousElementSibling;
        }
        if (assistedLogo?.localName !== "p") return;
        if (!assistedLogo) return;
        // Remove the blank paragraphs that Word otherwise carries onto this page.
        while (isEmptyParagraph(assistedLogo.previousElementSibling)) {
          assistedLogo.previousElementSibling.remove();
        }
        const assistedLogoProperties = prcEnsureWordChild(xml, assistedLogo, "pPr");
        prcEnsureWordChild(xml, assistedLogoProperties, "pageBreakBefore")
          .setAttributeNS(PRC_WORD_NS, "w:val", "1");
        const assistedHeaderSpacing = prcEnsureWordChild(xml, assistedLogoProperties, "spacing");
        // Add another 1 mm above the Assisted header (4 mm total).
        assistedHeaderSpacing.setAttributeNS(PRC_WORD_NS, "w:before", "227");
        assistedHeaderSpacing.setAttributeNS(PRC_WORD_NS, "w:after", "0");
        assistedHeaderSpacing.setAttributeNS(PRC_WORD_NS, "w:line", "1");
        assistedHeaderSpacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
        Array.from(assistedLogoProperties.children)
          .filter((child) => child.namespaceURI === PRC_WORD_NS && ["keepNext", "keepLines"].includes(child.localName))
          .forEach((child) => child.remove());
        let node = assistedLogo.nextElementSibling;
        while (node && !(node.namespaceURI === PRC_WORD_NS && node.localName === "tbl")) {
          const next = node.nextElementSibling;
          if (isEmptyParagraph(node)) {
            node.remove();
          } else if (node.namespaceURI === PRC_WORD_NS && node.localName === "p") {
            const paragraphProperties = prcEnsureWordChild(xml, node, "pPr");
            const spacing = prcEnsureWordChild(xml, paragraphProperties, "spacing");
            const text = prcWordText(node).trim();
            Array.from(paragraphProperties.children)
              .filter((child) => child.namespaceURI === PRC_WORD_NS && ["keepNext", "keepLines"].includes(child.localName))
              .forEach((child) => child.remove());
            spacing.setAttributeNS(PRC_WORD_NS, "w:before", "0");
            // Give the applicant/school line clearance below the floating checkboxes.
            spacing.setAttributeNS(PRC_WORD_NS, "w:after", /Graduate Midwife/i.test(text) ? "120" : "0");
            spacing.setAttributeNS(PRC_WORD_NS, "w:line", /Record of Delivery Assisted/i.test(text) ? "360" : "240");
            spacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
          }
          node = next;
        }
      }

      function setPrcTemplateCell(cell, value, preserveNumbering = false, fontSizeHalfPoints = 16) {
        const paragraph = cell.getElementsByTagNameNS(PRC_WORD_NS, "p")[0];
        if (!paragraph) return;
        const cellProperties = prcEnsureWordChild(paragraph.ownerDocument, cell, "tcPr");
        const verticalAlignment = prcEnsureWordChild(paragraph.ownerDocument, cellProperties, "vAlign");
        verticalAlignment.setAttributeNS(PRC_WORD_NS, "w:val", "center");
        const cellMargins = prcEnsureWordChild(paragraph.ownerDocument, cellProperties, "tcMar");
        ["top", "bottom"].forEach((side) => {
          const margin = prcEnsureWordChild(paragraph.ownerDocument, cellMargins, side);
          margin.setAttributeNS(PRC_WORD_NS, "w:w", "10");
          margin.setAttributeNS(PRC_WORD_NS, "w:type", "dxa");
        });
        const paragraphProperties = prcEnsureWordChild(paragraph.ownerDocument, paragraph, "pPr");
        const spacing = prcEnsureWordChild(paragraph.ownerDocument, paragraphProperties, "spacing");
        spacing.setAttributeNS(PRC_WORD_NS, "w:before", "0");
        spacing.setAttributeNS(PRC_WORD_NS, "w:after", "0");
        spacing.setAttributeNS(PRC_WORD_NS, "w:line", String(Math.round(fontSizeHalfPoints * 10.5)));
        spacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
        if (!preserveNumbering) {
          Array.from(paragraphProperties.children)
            .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "numPr")
            .forEach((node) => node.remove());
        }
        let alignment = Array.from(paragraphProperties.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "jc");
        if (!alignment) {
          alignment = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:jc");
          const characterProperties = Array.from(paragraphProperties.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "rPr");
          paragraphProperties.insertBefore(alignment, characterProperties || null);
        }
        alignment.setAttributeNS(PRC_WORD_NS, "w:val", "center");
        const firstRun = paragraph.getElementsByTagNameNS(PRC_WORD_NS, "r")[0];
        const runProperties = firstRun?.getElementsByTagNameNS(PRC_WORD_NS, "rPr")[0]?.cloneNode(true) || paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:rPr");
        let fonts = Array.from(runProperties.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "rFonts");
        if (!fonts) {
          fonts = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:rFonts");
          runProperties.insertBefore(fonts, runProperties.firstChild);
        }
        ["ascii", "hAnsi", "cs"].forEach((script) => fonts.setAttributeNS(PRC_WORD_NS, `w:${script}`, "Cambria"));
        ["sz", "szCs"].forEach((property) => {
          let size = Array.from(runProperties.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === property);
          if (!size) {
            size = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, `w:${property}`);
            runProperties.appendChild(size);
          }
          size.setAttributeNS(PRC_WORD_NS, "w:val", String(fontSizeHalfPoints));
        });
        Array.from(paragraph.childNodes).forEach((node) => {
          if (!(node.nodeType === 1 && node.namespaceURI === PRC_WORD_NS && node.localName === "pPr")) paragraph.removeChild(node);
        });
        const lines = String(value || "").split("\n");
        lines.forEach((line, index) => {
          const run = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:r");
          run.appendChild(runProperties.cloneNode(true));
          const text = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:t");
          text.setAttributeNS(PRC_XML_NS, "xml:space", "preserve");
          text.textContent = line.toUpperCase();
          run.appendChild(text);
          paragraph.appendChild(run);
          if (index < lines.length - 1) {
            const breakRun = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:r");
            breakRun.appendChild(paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:br"));
            paragraph.appendChild(breakRun);
          }
        });
      }

      function compactAndUppercasePrcTemplateHeaders(xml) {
        Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "tbl")).forEach((table) => {
          const gridColumns = Array.from(table.getElementsByTagNameNS(PRC_WORD_NS, "gridCol"));
          if (gridColumns.length !== PRC_EXPORT_TABLE_COLUMNS.length) return;
          const headerRows = Array.from(table.children)
            .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tr")
            .slice(0, 2);
          headerRows.forEach((row) => {
            const rowProperties = prcEnsureWordChild(xml, row, "trPr");
            const rowHeight = prcEnsureWordChild(xml, rowProperties, "trHeight");
            rowHeight.setAttributeNS(PRC_WORD_NS, "w:val", "0");
            rowHeight.setAttributeNS(PRC_WORD_NS, "w:hRule", "atLeast");
            Array.from(row.children)
              .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tc")
              .forEach((cell) => {
                const cellProperties = prcEnsureWordChild(xml, cell, "tcPr");
                const cellMargins = prcEnsureWordChild(xml, cellProperties, "tcMar");
                ["top", "bottom"].forEach((side) => {
                  const margin = prcEnsureWordChild(xml, cellMargins, side);
                  margin.setAttributeNS(PRC_WORD_NS, "w:w", "20");
                  margin.setAttributeNS(PRC_WORD_NS, "w:type", "dxa");
                });
                Array.from(cell.getElementsByTagNameNS(PRC_WORD_NS, "p")).forEach((paragraph) => {
                  const paragraphProperties = prcEnsureWordChild(xml, paragraph, "pPr");
                  const spacing = prcEnsureWordChild(xml, paragraphProperties, "spacing");
                  spacing.setAttributeNS(PRC_WORD_NS, "w:before", "0");
                  spacing.setAttributeNS(PRC_WORD_NS, "w:after", "0");
                  spacing.setAttributeNS(PRC_WORD_NS, "w:line", "147");
                  spacing.setAttributeNS(PRC_WORD_NS, "w:lineRule", "exact");
                });
                Array.from(cell.getElementsByTagNameNS(PRC_WORD_NS, "r")).forEach((run) => {
                  const runProperties = prcEnsureWordChild(xml, run, "rPr");
                  ["sz", "szCs"].forEach((property) => {
                    const size = prcEnsureWordChild(xml, runProperties, property);
                    size.setAttributeNS(PRC_WORD_NS, "w:val", "14");
                  });
                });
                Array.from(cell.getElementsByTagNameNS(PRC_WORD_NS, "t")).forEach((textNode) => {
                  textNode.textContent = (textNode.textContent || "").toUpperCase();
                });
              });
          });
        });
      }

      function formatPrcDocxDateTime(value) {
        if (!value) return "";
        const date = PhilippineTime.parse(value, true);
        if (Number.isNaN(date.getTime())) return String(value);
        return `${date.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "2-digit", year: "numeric" })}\n${date.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}`;
      }

      function formatPrcDocxDate(value) { return formatPrcExportDate(value).replace(/<[^>]+>/g, ""); }

      function fillPrcTemplateTable(table, records, startIndex = 0) {
        const rows = Array.from(table.children).filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tr").slice(2);
        rows.forEach((row, index) => {
          const rowProperties = prcEnsureWordChild(table.ownerDocument, row, "trPr");
          if (row.firstElementChild !== rowProperties) row.insertBefore(rowProperties, row.firstElementChild);
          const rowHeight = prcEnsureWordChild(table.ownerDocument, rowProperties, "trHeight");
          rowHeight.setAttributeNS(PRC_WORD_NS, "w:val", "780");
          rowHeight.setAttributeNS(PRC_WORD_NS, "w:hRule", "exact");
          const cells = Array.from(row.children).filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tc");
          const values = getPrcExportRecordValues(records[index] || null, startIndex + index + 1);
          cells.forEach((cell, cellIndex) => setPrcTemplateCell(cell, values[cellIndex] || "", false, cellIndex === 2 ? 12 : 14));
        });
      }

      function setPrcTemplateText(node, value) {
        const textNodes = Array.from(node.getElementsByTagNameNS(PRC_WORD_NS, "t"));
        if (!textNodes.length) return;
        textNodes[0].textContent = value;
        textNodes[0].setAttributeNS(PRC_XML_NS, "xml:space", "preserve");
        textNodes.slice(1).forEach((textNode) => { textNode.textContent = ""; });
      }

      function setPrcTemplateDiagnosisHeader(table, procedureKey) {
        const headerRow = Array.from(table.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tr");
        const headerCells = headerRow ? Array.from(headerRow.children).filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "tc") : [];
        const diagnosisCell = headerCells[2];
        if (!diagnosisCell) return;
        setPrcTemplateText(diagnosisCell, getPrcDiagnosisHeader(procedureKey).toUpperCase());
      }

      function setPrcTemplateFooterLicense(paragraph) {
        const textNodes = Array.from(paragraph.getElementsByTagNameNS(PRC_WORD_NS, "t"));
        const licenseIndex = textNodes.findIndex((node) => (node.textContent || "").includes("License Number:"));
        const expiryIndex = textNodes.findIndex((node) => (node.textContent || "").includes("Expiry Date:"));
        if (licenseIndex < 0 || expiryIndex < 0 || expiryIndex <= licenseIndex) return;
        const licenseValueNode = textNodes
          .slice(licenseIndex + 1, expiryIndex)
          .find((node) => /[_A-Za-z0-9]/.test(node.textContent || ""));
        const expiryValueNode = textNodes
          .slice(expiryIndex + 1)
          .find((node) => /[_A-Za-z0-9]/.test(node.textContent || ""));
        textNodes[licenseIndex].textContent = "License Number: ";
        textNodes[expiryIndex].textContent = "Expiry Date: ";
        if (licenseValueNode) {
          licenseValueNode.textContent = PRC_FOOTER_COPY.licenseNumber;
          const run = licenseValueNode.parentElement;
          if (run?.namespaceURI === PRC_WORD_NS && run.localName === "r") {
            let runProperties = Array.from(run.children).find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "rPr");
            if (!runProperties) {
              runProperties = paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:rPr");
              run.insertBefore(runProperties, run.firstChild);
            }
            if (!Array.from(runProperties.children).some((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "b")) {
              runProperties.appendChild(paragraph.ownerDocument.createElementNS(PRC_WORD_NS, "w:b"));
            }
          }
        }
        if (expiryValueNode) expiryValueNode.textContent = PRC_FOOTER_COPY.expiryLine;
      }

      function synchronizePrcTemplateWithPreview(xml) {
        const paragraphs = Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "p"));
        const clearPrcTemplateNumbering = (paragraph) => {
          const paragraphProperties = Array.from(paragraph.children)
            .find((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "pPr");
          Array.from(paragraphProperties?.children || [])
            .filter((node) => node.namespaceURI === PRC_WORD_NS && node.localName === "numPr")
            .forEach((node) => node.remove());
        };
        const procedureKeys = [...new Set(PRC_EXPORT_PAGE_LAYOUT.map((page) => page.procedureKey))];
        const titleParagraphs = paragraphs.filter((paragraph) => /Record of (Normal|Delivery Assisted|Actual Suturing|Actual Intravenous|Actual Internal)/.test(prcWordText(paragraph)));
        titleParagraphs.slice(0, procedureKeys.length).forEach((paragraph, index) => {
          setPrcTemplateText(paragraph, PRC_FORM_TITLES[procedureKeys[index]] || "");
        });

        paragraphs
          .filter((paragraph) => prcWordText(paragraph).includes("Clinical Instructor should ensure competence"))
          .forEach((paragraph) => {
            clearPrcTemplateNumbering(paragraph);
            const textNodes = Array.from(paragraph.getElementsByTagNameNS(PRC_WORD_NS, "t"));
            if (textNodes.length >= 3) {
              textNodes[0].textContent = "Note: ";
              textNodes[0].setAttributeNS(PRC_XML_NS, "xml:space", "preserve");
              textNodes[1].textContent = "(1) ";
              textNodes[1].setAttributeNS(PRC_XML_NS, "xml:space", "preserve");
              textNodes[2].textContent = PRC_FOOTER_COPY.noteOne.replace(/^\(1\)\s*/, "");
              textNodes.slice(3).forEach((textNode) => { textNode.textContent = ""; });
            } else {
              setPrcTemplateText(paragraph, `Note: ${PRC_FOOTER_COPY.noteOne}`);
            }
          });
        paragraphs
          .filter((paragraph) => prcWordText(paragraph).includes("Registered Midwives/ Clinical Instructors"))
          .forEach((paragraph) => {
            clearPrcTemplateNumbering(paragraph);
            const paragraphProperties = prcEnsureWordChild(xml, paragraph, "pPr");
            const noteIndent = prcEnsureWordChild(xml, paragraphProperties, "ind");
            noteIndent.setAttributeNS(PRC_WORD_NS, "w:left", "1440");
            ["right", "firstLine", "hanging"].forEach((attribute) => noteIndent.removeAttributeNS(PRC_WORD_NS, attribute));
            setPrcTemplateText(paragraph, PRC_FOOTER_COPY.noteTwo);
          });
        paragraphs
          .filter((paragraph) => prcWordText(paragraph).includes("License Number:"))
          .forEach(setPrcTemplateFooterLicense);
      }

      function ensurePrcTemplateUniqueDrawingIds(xml) {
        const drawingNamespace = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
        const drawingProperties = Array.from(xml.getElementsByTagNameNS(drawingNamespace, "docPr"));
        const assignedIds = new Set();
        let nextId = Math.max(0, ...drawingProperties.map((property) => Number(property.getAttribute("id")) || 0)) + 1;
        drawingProperties.forEach((property) => {
          const id = Number(property.getAttribute("id"));
          if (Number.isInteger(id) && id > 0 && !assignedIds.has(id)) {
            assignedIds.add(id);
            return;
          }
          while (assignedIds.has(nextId)) nextId += 1;
          property.setAttribute("id", String(nextId));
          assignedIds.add(nextId);
          nextId += 1;
        });
      }

      async function buildPrcTemplateDocx(records, options = {}) {
        const exportStudent = options.student || getStudent();
        const response = await fetch(PRC_TEMPLATE_URL, { cache: "no-store" });
        if (!response.ok) throw new Error("The PRC Word template could not be loaded.");
        const entries = await readPrcTemplateZip(await response.arrayBuffer());
        const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
        if (!documentEntry) throw new Error("The PRC Word template is missing its document layout.");
        const parser = new DOMParser();
        const xml = parser.parseFromString(new TextDecoder().decode(documentEntry.data), "application/xml");
        if (xml.querySelector("parsererror")) throw new Error("The PRC Word template could not be read.");
        addDeliveryAssistedPrcSheet(xml);
        setPrcTemplatePageLayout(xml);
        synchronizePrcTemplateWithPreview(xml);
        compactPrcTemplateHeaderSpacing(xml);
        compactAssistedPrcHeader(xml);
        ensurePrcTemplateUniqueDrawingIds(xml);
        compactAndUppercasePrcTemplateHeaders(xml);
        setPrcTemplateColumnWidths(xml);
        const studentName = exportStudent.student_name || exportStudent.name || "";
        const school = exportStudent.school_name || exportStudent.school || "BOHOL ISLAND STATE UNIVERSITY CALAPE";
        Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "p")).forEach((paragraph) => {
          if (!prcWordText(paragraph).includes("Name of Applicant:")) return;
          // Leave 1 mm between the applicant/school line and the case table.
          const applicantProperties = prcEnsureWordChild(xml, paragraph, "pPr");
          const applicantSpacing = prcEnsureWordChild(xml, applicantProperties, "spacing");
          applicantSpacing.setAttributeNS(PRC_WORD_NS, "w:after", "57");
          applicantSpacing.removeAttributeNS(PRC_WORD_NS, "afterLines");
          applicantSpacing.setAttributeNS(PRC_WORD_NS, "w:afterAutospacing", "0");
          const textNodes = Array.from(paragraph.getElementsByTagNameNS(PRC_WORD_NS, "t"));
          const applicantNode = textNodes.find((node) => /_{10,}/.test(node.textContent || ""));
          const schoolNode = textNodes.find((node) => (node.textContent || "").includes("BOHOL ISLAND STATE UNIVERSITY CALAPE"));
          if (studentName && applicantNode) {
            const originalLength = (applicantNode.textContent || "").length;
            applicantNode.textContent = `${studentName}${"_".repeat(Math.max(3, originalLength - studentName.length))}`;
          }
          if (school && schoolNode) schoolNode.textContent = school;
        });
        const recordsByProcedure = getPrcExportRecordsByProcedure(records);
        const tables = Array.from(xml.getElementsByTagNameNS(PRC_WORD_NS, "tbl"));
        if (tables.length < PRC_EXPORT_PAGE_LAYOUT.length) {
          throw new Error("The PRC Word template is missing one or more form pages.");
        }
        PRC_EXPORT_PAGE_LAYOUT.forEach(({ procedureKey, startIndex, rowCount }, tableIndex) => {
          const table = tables[tableIndex];
          setPrcTemplateDiagnosisHeader(table, procedureKey);
          fillPrcTemplateTable(table, recordsByProcedure[procedureKey].slice(startIndex, startIndex + rowCount), startIndex);
        });
        documentEntry.data = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${new XMLSerializer().serializeToString(xml.documentElement)}`);
        return new Blob([createPrcDocxZip(entries)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      }


    return { formatPrcExportDateTime, formatPrcExportDate, prcExportCell, getPrcExportRecordsByProcedure, getPrcExportRecordValues, buildPrcExportTable, getPrcLogoDataUrl, buildPrcExportFooter, buildPrcExportForms, buildPrcWordDocument, prcCrc32, prcZipU16, prcZipU32, prcInflate, readPrcTemplateZip, createPrcDocxZip, prcWordText, prcEnsureWordChild, setPrcTemplateLegalTableMargins, addDeliveryAssistedPrcSheet, setPrcTemplateColumnWidths, setPrcTemplatePageLayout, normalizePrcContinuationLabels, compactPrcTemplateHeaderSpacing, compactAssistedPrcHeader, setPrcTemplateCell, compactAndUppercasePrcTemplateHeaders, formatPrcDocxDateTime, formatPrcDocxDate, fillPrcTemplateTable, setPrcTemplateText, setPrcTemplateDiagnosisHeader, setPrcTemplateFooterLicense, synchronizePrcTemplateWithPreview, ensurePrcTemplateUniqueDrawingIds, buildPrcTemplateDocx };
  },
};

