/* ═══════ مِداد — الذكاء الاصطناعي بمفتاح المستخدم نفسه ═══════
   لمن يستخدم التطبيق دون حساب في مشروع صاحبه: يُدخل مفتاح Gemini الخاص به (مجاني من Google)،
   فيُحفظ على جهازه فقط ويتصل المتصفح بـGemini مباشرة. لا يمرّ المفتاح بأي خادم آخر،
   ولا يُزامَن ولا يدخل النسخة الاحتياطية. الموجّهات مطابقة لدالة الخادم «ai». */
const AIDirect = (() => {
  const KEY = 'midad-gemini-key';
  const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash']; // الاسم المستعار أولاً، ثم احتياط
  const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

  const getKey = () => { try { return (localStorage.getItem(KEY) || '').trim(); } catch { return ''; } };
  const hasKey = () => !!getKey();
  function setKey(k) {
    try { if (k && k.trim()) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch {}
  }

  function buildPrompt(action, p) {
    const book = String(p.text || '').slice(0, 200000);
    const base = 'أنت «مساعد القراءة» في تطبيق مِداد. أجب بالعربية الفصحى بأسلوب واضح ومنظّم، واستخدم عناوين ونقاطاً عند المناسبة. لا تُطل دون فائدة.';
    switch (action) {
      case 'summarize': return `${base}\n\nلخّص الكتاب «${p.title}» تلخيصاً وافياً: فكرته العامة، ثم أبرز أفكاره ومحاوره في نقاط، ثم خلاصة قصيرة.\n\n=== نص الكتاب ===\n${book}`;
      case 'keypoints': return `${base}\n\nاستخرج أهم النقاط والأفكار من الكتاب «${p.title}» في قائمة موجزة (٧ إلى ١٢ نقطة).\n\n=== نص الكتاب ===\n${book}`;
      case 'explain': return `${base}\n\nاشرح المقطع التالي وبسّط معناه للقارئ${p.title ? ` من كتاب «${p.title}»` : ''}، مع توضيح أي مصطلح غامض:\n\n«${String(p.text || '').slice(0, 8000)}»`;
      case 'ask': return `${base}\n\nأجب عن سؤال القارئ اعتماداً على نص الكتاب «${p.title}» أدناه. إن لم تكن الإجابة في النص فاذكر ذلك بصراحة ثم أجب بما تعرفه إن أمكن.\n\nالسؤال: ${p.question}\n\n=== نص الكتاب ===\n${book}`;
      case 'flashcards': return `${base}\n\nأنشئ من الكتاب «${p.title}» بطاقات مراجعة تعليمية (١٠ إلى ١٥ بطاقة) تغطّي أهم أفكاره ومصطلحاته. أعِد النتيجة بصيغة JSON فقط، دون أي نص قبله أو بعده، على هيئة مصفوفة عناصرها {"q":"سؤال أو مصطلح موجز","a":"الجواب أو التعريف المختصر"}.\n\n=== نص الكتاب ===\n${book}`;
      case 'quiz': return `${base}\n\nأنشئ اختباراً من متعدّد الخيارات (٦ إلى ٨ أسئلة) على محتوى الكتاب «${p.title}». أعِد النتيجة بصيغة JSON فقط دون أي نص إضافي، مصفوفة عناصرها {"q":"نص السؤال","options":["أ","ب","ج","د"],"correct":0,"why":"سبب موجز للإجابة الصحيحة"} حيث correct فهرس الخيار الصحيح (يبدأ من 0).\n\n=== نص الكتاب ===\n${book}`;
      case 'translate': return `${base}\n\nترجم النص التالي إلى ${p.question || 'الإنجليزية'} ترجمةً دقيقة وطبيعية، وأعد الترجمة فقط دون شرح:\n\n«${String(p.text || '').slice(0, 4000)}»`;
      case 'library': return `${base}\n\nأجب عن سؤال القارئ اعتماداً على المقتطفات التالية المأخوذة من كتب مكتبته (كل مقتطف مسبوق بمصدره). اذكر في جوابك من أي كتاب استقيت المعلومة. إن لم تكفِ المقتطفات فاذكر ذلك.\n\nالسؤال: ${p.question}\n\n=== مقتطفات من المكتبة ===\n${book}`;
      default: return `${base}\n\n${p.text || ''}`;
    }
  }

  const OCR_PROMPT =
    'أنت محرّرٌ يستخرج نص صفحة كتاب من صورتها ويعيده منسّقاً نظيفاً بصيغة ماركداون بسيطة بالعربية، وفق القواعد:\n' +
    '• انقل النص حرفياً دون ترجمة أو تلخيص أو إضافة من عندك.\n' +
    '• تجاهل ترويسة الصفحة المتكرّرة (اسم الكتاب أو الفصل أعلى الصفحة) والحواشي الجانبية.\n' +
    '• احتفظ برقم الصفحة إن وُجد، واجعله في سطر مستقلّ بمفرده.\n' +
    '• ادمج الأسطر المقطوعة في فقرات متّصلة، وافصل بين الفقرات بسطر فارغ واحد (لا تقطع الفقرة عند نهاية السطر).\n' +
    '• عناوين الفصول أو الأقسام: ابدأ سطرها بـ «# »، والعناوين الفرعية بـ «## ».\n' +
    '• إن فصل خطٌّ أفقي أسفل الصفحة بين المتن والحواشي/المراجع، فضع سطراً فيه «---» مكانه، واجعل كل حاشية مرقّمة (مثل «(١) …») في سطرٍ مستقل.\n' +
    '• الاقتباسات المميّزة: ابدأ سطرها بـ «> ». أبيات الشعر: بصيغة «/ الشطر الأول | الشطر الثاني».\n' +
    '• أعد النص المنسّق فقط دون أي شرح. وإن كانت الصفحة بلا نص مقروء فأعد سطراً فارغاً.';

  // رسالة مفهومة لأخطاء Gemini الشائعة
  function friendly(status, msg) {
    if (status === 429 || /quota|exhausted|rate/i.test(msg)) return 'تجاوز مفتاحك حصّة الاستخدام المجانية مؤقتاً — حاول بعد قليل';
    if (status === 401 || (status === 400 && /api.?key|API_KEY_INVALID|not valid/i.test(msg))) return 'مفتاح Gemini غير صالح — راجعه في «🤖 الذكاء الاصطناعي»';
    if (status === 403) return 'مفتاح Gemini لا يملك صلاحية — تأكّد أنه مفعّل لـ Generative Language API';
    return msg || 'تعذّر الاتصال بـ Gemini';
  }

  async function post(model, body) {
    const key = getKey();
    if (!key) throw new Error('أضِف مفتاح Gemini الخاص بك أولاً');
    // المفتاح في ترويسة لا في الرابط (لا يظهر في السجلات)؛ يقبل الصيغتين القديمة AIza… والجديدة AQ.…
    const res = await fetch(`${API}${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
    let data = null; try { data = await res.json(); } catch {}
    return { res, data };
  }

  // يجرّب النماذج بالترتيب: إن لم يتوفّر الاسم المستعار لمفتاحٍ ما، يُستعمل الاحتياطي
  async function generate(parts, genCfg) {
    let last = null;
    for (const model of MODELS) {
      const { res, data } = await post(model, { contents: [{ role: 'user', parts }], generationConfig: genCfg });
      if (res.ok) return (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
      const msg = data?.error?.message || '';
      last = new Error(friendly(res.status, msg));
      if (!(res.status === 404 || /not found|not supported/i.test(msg))) break; // خطأ حقيقي ⇒ لا تجرّب غيره
    }
    throw last || new Error('تعذّر الاتصال بـ Gemini');
  }

  // PCM (16-bit أحادي) ⇒ WAV base64 ليُشغَّل مباشرة
  function pcmToWavBase64(b64pcm, rate) {
    const pcm = Uint8Array.from(atob(b64pcm), (c) => c.charCodeAt(0));
    const buf = new ArrayBuffer(44 + pcm.length), dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, pcm.length, true); new Uint8Array(buf, 44).set(pcm);
    const out = new Uint8Array(buf); let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  // نفس عقد دالة الخادم: {text} للنصوص و{audio,mime} للصوت
  async function invoke(b = {}) {
    const action = String(b.action || 'ask');
    if (action === 'diag') return { text: `مفتاحك الخاص: …${getKey().slice(-4)}\nالنموذج: ${MODELS[0]} (احتياطي: ${MODELS[1]})\nيتصل المتصفح بـ Gemini مباشرة.` };
    if (action === 'tts') {
      const text = String(b.text || '').slice(0, 3000).trim();
      if (!text) throw new Error('لا يوجد نص للنطق');
      const { res, data } = await post(TTS_MODEL, {
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: b.voice || 'Kore' } } } },
      });
      if (!res.ok) throw new Error(friendly(res.status, data?.error?.message || ''));
      const part = (data?.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData);
      if (!part) throw new Error('لم يصل صوت من النموذج');
      const rate = parseInt((String(part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1] || '24000', 10);
      return { audio: pcmToWavBase64(part.inlineData.data, rate), mime: 'audio/wav' };
    }
    if (action === 'ocr') {
      if (!b.image) throw new Error('لا توجد صورة للاستخراج');
      const text = await generate([{ text: OCR_PROMPT }, { inlineData: { mimeType: b.mimeType || 'image/jpeg', data: b.image } }], { temperature: 0.1, maxOutputTokens: 4096 });
      return { text };
    }
    const prompt = buildPrompt(action, { text: String(b.text || ''), question: String(b.question || ''), title: String(b.title || '') });
    const text = await generate([{ text: prompt }], { temperature: 0.4, maxOutputTokens: 2048 });
    return { text: text || 'لم يصل رد.' };
  }

  // اختبار المفتاح بطلب صغير
  async function test(k) {
    const prev = getKey();
    if (k !== undefined) setKey(k);
    try { const t = await generate([{ text: 'أجب بكلمة واحدة: نعم' }], { temperature: 0, maxOutputTokens: 10 }); return { ok: true, text: t }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
    finally { if (k !== undefined) setKey(prev); }
  }

  return { hasKey, getKey, setKey, invoke, test };
})();
window.AIDirect = AIDirect;
