/* ═══════ مِداد — التشغيل ═══════ */
const APP_VERSION = 'v47'; // يُحدَّث مع كل إصدار

(async function boot() {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  { const v = document.getElementById('app-ver'); if (v) v.textContent = APP_VERSION; }

  await Store.init();
  await seedGuide();
  // المكتبة يجب أن تظهر دائماً حتى لو فشل ربط القارئ (مثلاً عند عدم تطابق نسخ الملفات)
  try { Reader.wire(); } catch (e) { console.error('reader wire', e); }
  try { await Library.init(); } catch (e) { console.error('library init', e); }
  try { if (window.Cloud) Cloud.init(); } catch (e) { console.error('cloud init', e); }

  // تسجيل عامل الخدمة (تطبيق قابل للتثبيت + عمل بلا إنترنت) مع تحديث مُتحكَّم فيه
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        const offerUpdate = (worker) => { if (worker) showUpdateBanner(worker); };
        // عامل جديد ينتظر بالفعل
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        // اكتشاف تحديث جديد أثناء التشغيل
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(nw);
          });
        });
        // عند تفعيل العامل الجديد: أعد التحميل مرّة واحدة فقط
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return; reloaded = true; location.reload();
        });
        // افحص وجود تحديث عند العودة للتطبيق
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      } catch {}
    });
  }

  function showUpdateBanner(worker) {
    if (document.getElementById('update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.className = 'update-banner';
    bar.innerHTML = '<span>✨ تحديث جديد للتطبيق جاهز</span><button class="ub-go">تحديث الآن</button><button class="ub-x" title="لاحقاً">✕</button>';
    bar.querySelector('.ub-go').onclick = () => { bar.classList.add('going'); worker.postMessage({ type: 'SKIP_WAITING' }); };
    bar.querySelector('.ub-x').onclick = () => bar.remove();
    document.body.appendChild(bar);
  }

  // زر التثبيت بنقرة واحدة (يظهر عندما يسمح المتصفح)
  let deferredPrompt = null;
  const installBtn = () => document.getElementById('btn-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const b = installBtn();
    if (b) {
      b.hidden = false;
      b.onclick = async () => {
        b.hidden = true;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch {}
        deferredPrompt = null;
      };
    }
  });
  window.addEventListener('appinstalled', () => { const b = installBtn(); if (b) b.hidden = true; });

  // ── كشف انقطاع/عودة الشبكة (رسائل واضحة + إعادة مزامنة تلقائية) ──
  const netToast = (msg, kind) => { if (window.Library) Library.toast(msg, kind); };
  let wasOffline = !navigator.onLine;
  window.addEventListener('offline', () => { wasOffline = true; netToast('لا يوجد اتصال — القراءة والمكتبة تعملان بلا إنترنت', ''); });
  window.addEventListener('online', () => {
    if (!wasOffline) return;
    wasOffline = false;
    netToast('عاد الاتصال بالإنترنت ✓', 'gold');
    try { if (window.Cloud && Cloud.isSignedIn && Cloud.isSignedIn()) Cloud.syncAll(); } catch {}
  });

  // منع الأخطاء غير المُلتقطة من إزعاج المستخدم (تُسجَّل بهدوء للتشخيص فقط)
  window.addEventListener('unhandledrejection', (e) => {
    console.warn('unhandled', (e.reason && (e.reason.message || e.reason)) || e);
  });
})();

/* كتاب ترحيبي يشرح مزايا التطبيق ويستعرض القارئ */
async function seedGuide() {
  if (localStorage.getItem('midad-seeded')) return;
  const existing = await Store.getBooks();
  if (existing.length) { localStorage.setItem('midad-seeded', '1'); return; }

  const text = `# أهلاً بك في مِداد

مرحباً بك في مكتبتك الرقمية الجديدة. صُمّم «مِداد» ليمنحك أجمل تجربة قراءة عربية ممكنة: ورقٌ تختار لونه، وإضاءة تريح عينيك، وصفحات تنقلب بين يديك كما في الكتب الحقيقية، وملاحظات تدوّنها في هامش رحلتك مع كل كتاب.

هذا الكتاب القصير دليلك للتعرّف على كل ما يقدّمه التطبيق. اقرأه بتمهّل، وجرّب كل ميزة وأنت تقرأ عنها، فخير وسيلة للتعلّم هي التجربة.

# إضافة الكتب إلى مكتبتك

من الشاشة الرئيسية اضغط زر «أضف كتاباً» الذهبي. يمكنك إضافة الكتب بطريقتين.

الطريقة الأولى: ملفات PDF. اسحب أي ملف PDF وأفلته في النافذة، وسيتكفّل مِداد بقراءته وتوليد غلاف له من صفحته الأولى تلقائياً، مع حفظ عدد صفحاته وكل تفاصيله.

الطريقة الثانية: النصوص. الصق أي نص مباشرة، أو اختر ملف TXT من جهازك. وإن بدأت أسطر العناوين بعلامة # فسيبني مِداد فهرساً تفاعلياً للكتاب تلقائياً، تماماً كالفهرس الذي تراه الآن في هذا الدليل عند فتح أيقونة القوائم في الأعلى.

الطريقة الثالثة: من رابط. الصق رابطاً مباشراً لملف PDF أو نص على الإنترنت في لسان «من رابط»، وسيجلبه مِداد ويحفظه في مكتبتك.

كل كتبك تُحفظ داخل متصفحك على جهازك أنت، فلا تغادر بياناتك جهازك أبداً.

# فن القراءة المريحة

اضغط على زر «ع» في الشريط العلوي لفتح إعدادات القراءة، وستجد عالماً من الخيارات.

لون الورق: مجموعة واسعة من الألوان الجاهزة تتدرّج من الأبيض الناصع إلى الأسود الليلي، مروراً بالكريمي والسيبيا والورق العتيق والوردي والنعناعي وغيرها. وإن لم يعجبك أيٌّ منها فاختر لونك الخاص من منتقي الألوان.

الإضاءة: تحكّم في سطوع الصفحة بدقة، وفعّل «الإضاءة الدافئة» في ليالي القراءة الطويلة لتحصل على ضوء برتقالي هادئ يحاكي مصابيح القراءة القديمة ويريح عينيك قبل النوم.

الخلفية: اقرأ في أجواء «الغسق» البنفسجية، أو على «مكتب خشبي» كلاسيكي، أو اختر خلفية حيادية صافية.

الخط: مجموعة من الخطوط العربية الأصيلة والاحترافية بين النسخ والأميري وشهرزاد ومركزي والرقعة والحديثة، مع تحكم كامل في حجم الخط وتباعد الأسطر وعرض النص.

# التنقّل بين الصفحات

في مِداد ثلاث طرق للتنقل، اختر ما يحلو لك من إعدادات القراءة.

التقليب الورقي: الصفحات تنقلب أمامك بحركة ثلاثية الأبعاد تحاكي الورق الحقيقي. جرّبها الآن بالضغط على حافة الصفحة اليسرى أو بسهم لوحة المفاتيح.

الانزلاق: انتقال سلس وسريع لمن يفضّل البساطة.

التمرير المتصل: اقرأ الكتاب كصفحة واحدة طويلة تتدحرج بعجلة الفأرة، كما تقرأ المقالات.

وفي كل الأحوال يمكنك النقر على يسار الصفحة للتقدم، وعلى يمينها للرجوع، والنقر في المنتصف لإخفاء الواجهة والاستغراق في القراءة. وشريط التقدم في الأسفل ينقلك إلى أي موضع في الكتاب بسحبة واحدة.

# مؤشر القراءة والعلامات المرجعية

لا تقلق أبداً بشأن الموضع الذي توقفت عنده، فمِداد يحفظه تلقائياً لحظة بلحظة. أغلق الكتاب ثم افتحه بعد شهر، وستجد نفسك في السطر ذاته الذي غادرته.

وفي الشاشة الرئيسية ستجد بطاقة «واصل القراءة» تتصدّر مكتبتك، تحمل آخر كتاب فتحته ونسبة إنجازك فيه، فتعود إليه بضغطة واحدة.

أما العلامات المرجعية فهي الشريط الأحمر أعلى الصفحة. اضغطه الآن وسترى كيف يتدلى كشريط حريري يحفظ لك هذا الموضع للأبد، أو اضغط حرف B في لوحة المفاتيح. وتجد كل علاماتك في قائمة «العلامات» للقفز بينها متى شئت.

# التظليل والملاحظات

هنا يتحول القارئ من متلقٍّ إلى محاوِر. ظلّل بالفأرة أي عبارة تعجبك في هذا السطر الآن، وستظهر لك لوحة ألوان صغيرة.

اختر لوناً من الألوان الأربعة ليبقى النص مظللاً، أو اضغط «تظليل + ملاحظة» لتكتب خاطرتك حول ما قرأت. والنص المظلّل يبقى حياً: اضغط عليه في أي وقت لتغيير لونه أو تحرير ملاحظته أو حذفه.

كل تظليلاتك وملاحظاتك مجموعة في قائمة «الملاحظات»، مرتبة حسب موضعها في الكتاب، والضغط على أي منها ينقلك إلى موضعه فوراً. ويمكنك تصديرها كلها في ملف نصي أنيق تحتفظ به أو تشاركه، من زر «تصدير الملاحظات».

وفي كتب PDF يمكنك إضافة ملاحظة على كل صفحة من القائمة ذاتها.

# البحث والفهرس

اضغط أيقونة العدسة للبحث في نص الكتاب كاملاً. اكتب أي كلمة وستظهر لك النتائج مع سياقها، والضغط على أي نتيجة ينقلك إلى صفحتها مباشرة.

أما الفهرس فيُبنى تلقائياً من عناوين الكتاب، ويظهر فيه الفصل الذي تقرؤه الآن مضاءً، لتعرف دائماً أين أنت من الكتاب.

# إحصاءات قراءتك

يحسب مِداد زمن قراءتك الفعلي في كل كتاب، ويعرض لك في أسفل الشاشة تقديراً للوقت المتبقي لإنهائه بناءً على طول النص، فتعرف قبل أن تبدأ الفصل الأخير أنه لن يأخذ من ليلتك سوى دقائق.

وعند بلوغك آخر صفحة، سيحتفل معك مِداد ويضع على غلاف الكتاب وسام «مكتمل» الأخضر في مكتبتك.

# الخاتمة

هذا كل شيء. أضف أول كتبك الآن، ورتّب مكتبتك بالتصنيفات، وابحث فيها، وافرز كتبك بحسب تقدمك فيها.

نتمنى لك ساعات قراءة طويلة وممتعة. وتذكّر قول الجاحظ: الكتاب هو الجليس الذي لا يطريك، والصديق الذي لا يقليك.

قراءة سعيدة بمداد لا ينفد.`;

  await Store.addBook({
    title: 'دليل مِداد — رحلتك مع القراءة',
    author: 'فريق مِداد',
    category: 'أخرى',
    type: 'text',
  }, text);
  localStorage.setItem('midad-seeded', '1');
}
