
const formatVal = (obj) => {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return obj.map(o => formatVal(o)).filter(Boolean).join('\n---\n');
  return Object.entries(obj)
    .filter(([k,v]) => v !== null && v !== '' && !['id','tender_id','lead_id','created_at','updated_at','created_by','submitted_by'].includes(k) && !k.endsWith('_url'))
    .map(([k,v]) => {
       let val = v;
       if (k === 'survey_notes' && typeof v === 'string') {
          try { val = '\n  ' + formatVal(JSON.parse(v)).replace(/\n/g, '\n  '); } catch(e){}
       } else if (typeof v === 'object') {
          val = '\n  ' + formatVal(v).replace(/\n/g, '\n  ');
       }
       return k.replace(/_/g, ' ') + ': ' + val;
    }).join('\n');
};

const data = [{
  id: 'afe9cb1d-89b6-4a9d-96a4-18426d25296c',
  tender_id: '80d89cef-592b-4a77-85fa-8072c15c4867',
  submitted_by: '7aa2c860-f6ce-4191-a84e-f2622420ce34',
  feasibility_status: 'pending',
  survey_notes: '{\"site_address\":\"NIELIT Delhi Centre\"}',
  feasibility_doc_url: null
}];

console.log(formatVal(data));

