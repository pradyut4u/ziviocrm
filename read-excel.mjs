import xlsx from 'xlsx';

function inspectFile(filePath) {
    try {
        const workbook = xlsx.readFile(filePath);
        const result = {};
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet, { defval: null });
            if (data.length === 0) {
                result[sheetName] = { headers: [], rowCount: 0 };
            } else {
                result[sheetName] = {
                    headers: Object.keys(data[0]),
                    rowCount: data.length,
                    sample: data[0]
                };
            }
        }
        return result;
    } catch(e) {
        return { error: e.message };
    }
}

console.log(JSON.stringify({
    Tender: inspectFile('d:/tender ops/Tender.xlsx'),
    Tech: inspectFile('d:/tender ops/Tech.xlsx')
}, null, 2));
