import { getSync, setSync, getActiveTabId, injectCustomEvent, openOptions } from '../modules/utils.js';

export function initEngagePage() {
	const engageType = document.getElementById('engage-type');
	const maxEngage = document.getElementById('max-engage');
	const openFeedBtn = document.getElementById('open-engage-feed');
	const startEngageBtn = document.getElementById('start-engage');

	async function load() {
		const { engage = { type: 'likes', max: 20 } } = await getSync({ engage: { type: 'likes', max: 20 } });
		if (engageType) engageType.value = engage.type;
		if (maxEngage) maxEngage.value = String(engage.max);
	}

	async function save() {
		const engage = { type: String(engageType?.value || 'likes'), max: Number(maxEngage?.value || 20) };
		await setSync({ engage });
	}

	if (engageType) engageType.addEventListener('change', save);
	if (maxEngage) maxEngage.addEventListener('change', save);

	if (openFeedBtn) {
		openFeedBtn.addEventListener('click', async () => {
			// Placeholder: open some feed depending on engage type
			const { type } = await getSync({ engage: { type: 'likes' } }).then(s => s.engage || { type: 'likes' });
			const url = type === 'retweets' ? 'https://x.com/search?q=filter%3Aretweets&src=typed_query' : 'https://x.com/search?q=filter%3Alikes&src=typed_query';
			await chrome.tabs.create({ url });
		});
	}

	if (startEngageBtn) {
		startEngageBtn.addEventListener('click', async () => {
			await save();
			const tabId = await getActiveTabId();
			await injectCustomEvent(tabId, 'UTT_START_ENGAGE', {});
		});
	}

	load();
}


