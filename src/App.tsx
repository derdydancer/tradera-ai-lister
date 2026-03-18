import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, List, Save, Trash2, Download, Plus, Loader2, Edit3, X } from 'lucide-react';
import Papa from 'papaparse';

interface AdData {
  id?: string;
  Rubrik: string;
  Beskrivning: string;
  Bilder: string;
  Kategori: string;
  Attribut: string;
  Utropspris: string;
  'Köp nu-pris': string;
  Reservationspris: string;
  'Fraktsätt #1': string;
  'Fraktsätt #2': string;
  'Erbjud avhämtning': string;
  'Accepterade budgivare': string;
  Annonslängd: string;
  Annonstyp: string;
  Highlight: string;
  Omstarter: string;
  'Rank up': string;
  Referens: string;
  'Vald sluttid': string;
  Moms: string;
  Lagersaldo: string;
}

import { GoogleGenAI } from '@google/genai';

const DEFAULT_AD: AdData = {
  Rubrik: '',
  Beskrivning: '',
  Bilder: '',
  Kategori: '',
  Attribut: '',
  Utropspris: '',
  'Köp nu-pris': '',
  Reservationspris: '',
  'Fraktsätt #1': '',
  'Fraktsätt #2': '',
  'Erbjud avhämtning': 'true',
  'Accepterade budgivare': '1',
  Annonslängd: '7',
  Annonstyp: 'Auction',
  Highlight: 'false',
  Omstarter: '2',
  'Rank up': 'false',
  Referens: '',
  'Vald sluttid': '',
  Moms: '',
  Lagersaldo: '1',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create');
  const [ads, setAds] = useState<AdData[]>([]);
  const [currentAd, setCurrentAd] = useState<AdData>(DEFAULT_AD);
  const [images, setImages] = useState<File[]>([]);
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    console.log('[Client] App component mounted. Fetching ads...');
    fetchAds();
  }, []);

  const fetchAds = async () => {
    try {
      console.log('[Client] Fetching ads from /api/ads...');
      const res = await fetch('/api/ads');
      if (!res.ok) {
        console.error(`[Client] API error fetching ads: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      console.log(`[Client] Successfully fetched ${data.length} ads.`);
      setAds(data);
    } catch (error) {
      console.error('[Client] Failed to fetch ads:', error);
    }
  };

  const handleImageUpload = async () => {
    if (images.length === 0) return [];
    
    const formData = new FormData();
    images.forEach(img => formData.append('images', img));

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    return data.urls || [];
  };

  const generateAd = async () => {
    if (images.length === 0) {
      alert('Vänligen lägg till minst en bild.');
      return;
    }

    setIsGenerating(true);
    try {
      // First, upload images to backend to get URLs for saving
      const uploadedUrls = await handleImageUpload();
      
      // Read files as base64 for Gemini
      const parts: any[] = [];
      for (const file of images) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
            const base64 = result.split(',')[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: file.type || 'image/jpeg'
          }
        });
      }

      const prompt = `
Du är en expert på att skapa säljande annonser för e-handel och auktionssajter (som Tradera).
Skapa en annons baserat på de bifogade bilderna och följande extra information: "${description || 'Ingen extra information'}".

Returnera resultatet som ett JSON-objekt med följande fält (använd exakt dessa nycklar):
- "Rubrik": En säljande och tydlig rubrik (max 80 tecken).
- "Beskrivning": En utförlig objektsbeskrivning. Framhäv skick, märke, material och andra detaljer.
- "Kategori": Försök gissa en relevant kategori (i text, användaren får mappa till ID senare).
- "Utropspris": Ett rimligt utropspris i SEK (heltal).
- "Köp nu-pris": Ett rimligt köp-nu pris i SEK (heltal).
- "Attribut": Gissa relevanta attribut och slå ihop dem med semikolon. Formatet är "id:värde". 
  Viktiga ID:n:
  - Skick (ID 121): Välj ett av "Oanvänt", "Nyskick", "Gott skick", "Välanvänt skick", "Defekt". Exempel: "121:Gott skick".
  - Färg (ID 2): Max två färger separerade med kommatecken. Exempel: "2:svart,vit".
  - Märke (ID 3): Exempel: "3:Nike".
  - Storlek (ID 1): Exempel: "1:M".
  Slå ihop dem så här: "1:M;2:svart,vit;3:Nike;121:Gott skick".
- "Annonstyp": Välj "Auction" eller "FixedPrice".

Svara ENDAST med giltig JSON, inga markdown-block eller annan text.
`;

      parts.push({ text: prompt });

      const configRes = await fetch('/api/config');
      const configData = await configRes.json();
      
      if (!configData.geminiApiKey) {
        throw new Error('API key not found on server');
      }

      const ai = new GoogleGenAI({ apiKey: configData.geminiApiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: { parts },
        config: {
          responseMimeType: 'application/json'
        }
      });

      const generatedText = response.text || '{}';
      const generatedData = JSON.parse(generatedText);
      
      setCurrentAd({
        ...DEFAULT_AD,
        ...generatedData,
        Bilder: uploadedUrls.join(','),
      });
      
    } catch (error) {
      console.error('Generation failed:', error);
      alert('Kunde inte generera annons.');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveAd = async () => {
    setIsSaving(true);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/ads/${editingId}` : '/api/ads';
      
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentAd),
      });
      
      await fetchAds();
      resetForm();
      setActiveTab('list');
    } catch (error) {
      console.error('Failed to save ad:', error);
      alert('Kunde inte spara annonsen.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteAd = async (id: string) => {
    if (!confirm('Är du säker på att du vill radera annonsen?')) return;
    try {
      await fetch(`/api/ads/${id}`, { method: 'DELETE' });
      await fetchAds();
    } catch (error) {
      console.error('Failed to delete ad:', error);
    }
  };

  const editAd = (ad: AdData) => {
    setCurrentAd(ad);
    setEditingId(ad.id || null);
    setActiveTab('create');
    setImages([]);
    setDescription('');
  };

  const resetForm = () => {
    setCurrentAd(DEFAULT_AD);
    setEditingId(null);
    setImages([]);
    setDescription('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportToCSV = () => {
    if (ads.length === 0) {
      alert('Inga annonser att exportera.');
      return;
    }

    // ProLister requires specific column names. We map our state to those columns.
    // Some fields might need formatting, but we try to keep them as strings.
    const csvData = ads.map(ad => {
      const row: any = { ...ad };
      delete row.id;
      delete row.createdAt;
      delete row.updatedAt;
      return row;
    });

    const csv = Papa.unparse(csvData, { delimiter: ',' });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `annonser_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCurrentAd(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
              AL
            </div>
            <h1 className="text-xl font-semibold tracking-tight">AI Lister <span className="text-xs font-normal text-neutral-500 ml-2" title="Version">v1.0</span></h1>
          </div>
          <nav className="flex gap-1">
            <button
              onClick={() => setActiveTab('create')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'create' ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'}`}
              title="Skapa en ny annons eller redigera en befintlig"
            >
              <div className="flex items-center gap-2">
                <Plus size={16} />
                Skapa Annons
              </div>
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'}`}
              title="Visa alla sparade annonser"
            >
              <div className="flex items-center gap-2">
                <List size={16} />
                Mina Annonser ({ads.length})
              </div>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: AI Generation Input */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-neutral-200">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Upload size={20} className="text-indigo-600" />
                  AI-Generering
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Ladda upp bilder på varan">Bilder</label>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={(e) => setImages(Array.from(e.target.files || []))}
                      className="block w-full text-sm text-neutral-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-colors"
                    />
                    {images.length > 0 && (
                      <p className="mt-2 text-xs text-neutral-500">{images.length} bild(er) valda</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Valfri extra information om varan">Extra beskrivning (valfritt)</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={4}
                      placeholder="T.ex. defekt dragkedja, köpt 2022..."
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>

                  <button
                    onClick={generateAd}
                    disabled={isGenerating || images.length === 0}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2 px-4 rounded-md font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Skapa annonsdata med hjälp av AI"
                  >
                    {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                    {isGenerating ? 'Genererar...' : 'Generera med AI'}
                  </button>
                  
                  {editingId && (
                    <button
                      onClick={resetForm}
                      className="w-full flex items-center justify-center gap-2 bg-neutral-200 text-neutral-800 py-2 px-4 rounded-md font-medium hover:bg-neutral-300 transition-colors"
                      title="Avbryt redigering och skapa ny"
                    >
                      <X size={18} />
                      Avbryt redigering
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Ad Details Form */}
            <div className="lg:col-span-8">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-neutral-200">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold">Annonsdetaljer</h2>
                  <button
                    onClick={saveAd}
                    disabled={isSaving || !currentAd.Rubrik}
                    className="flex items-center gap-2 bg-emerald-600 text-white py-2 px-4 rounded-md font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Spara annonsen till din lista"
                  >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    Spara Annons
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Annonsens rubrik (max 80 tecken)">Rubrik</label>
                    <input
                      type="text"
                      name="Rubrik"
                      value={currentAd.Rubrik}
                      onChange={handleInputChange}
                      maxLength={80}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Utförlig beskrivning av varan">Beskrivning</label>
                    <textarea
                      name="Beskrivning"
                      value={currentAd.Beskrivning}
                      onChange={handleInputChange}
                      rows={6}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Kategori-ID för plattformen">Kategori (ID)</label>
                    <input
                      type="text"
                      name="Kategori"
                      value={currentAd.Kategori}
                      onChange={handleInputChange}
                      placeholder="T.ex. 16 för kläder"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Attribut i formatet id:värde;id:värde">Attribut</label>
                    <input
                      type="text"
                      name="Attribut"
                      value={currentAd.Attribut}
                      onChange={handleInputChange}
                      placeholder="T.ex. märke:Nike;storlek:M"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Utropspris i hela kronor">Utropspris (kr)</label>
                    <input
                      type="number"
                      name="Utropspris"
                      value={currentAd.Utropspris}
                      onChange={handleInputChange}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Köp nu-pris i hela kronor">Köp nu-pris (kr)</label>
                    <input
                      type="number"
                      name="Köp nu-pris"
                      value={currentAd['Köp nu-pris']}
                      onChange={handleInputChange}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Auktion, Fast pris eller Butiksannons">Annonstyp</label>
                    <select
                      name="Annonstyp"
                      value={currentAd.Annonstyp}
                      onChange={handleInputChange}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Auction">Auktion (Auction)</option>
                      <option value="FixedPrice">Fast pris (FixedPrice)</option>
                      <option value="ShopItem">Butiksannons (ShopItem)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Annonsens längd i dagar">Annonslängd (dagar)</label>
                    <input
                      type="number"
                      name="Annonslängd"
                      value={currentAd.Annonslängd}
                      onChange={handleInputChange}
                      placeholder="3-14 för auktion"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Fraktsätt 1 (vikt:providerId:produktId:pris)">Fraktsätt #1</label>
                    <input
                      type="text"
                      name="Fraktsätt #1"
                      value={currentAd['Fraktsätt #1']}
                      onChange={handleInputChange}
                      placeholder="T.ex. 1:2:47"
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Fraktsätt 2 (vikt:providerId:produktId:pris)">Fraktsätt #2</label>
                    <input
                      type="text"
                      name="Fraktsätt #2"
                      value={currentAd['Fraktsätt #2']}
                      onChange={handleInputChange}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-neutral-700 mb-1" title="Kommaseparerad lista med bild-URL:er">Bilder (URL:er)</label>
                    <input
                      type="text"
                      name="Bilder"
                      value={currentAd.Bilder}
                      onChange={handleInputChange}
                      className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-neutral-50"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'list' && (
          <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-6 border-b border-neutral-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Mina Annonser</h2>
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 bg-indigo-600 text-white py-2 px-4 rounded-md font-medium hover:bg-indigo-700 transition-colors"
                title="Exportera alla annonser till en CSV-fil för ProLister"
              >
                <Download size={18} />
                Exportera CSV
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-neutral-600 font-medium border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-3">Bild</th>
                    <th className="px-6 py-3">Rubrik</th>
                    <th className="px-6 py-3">Typ</th>
                    <th className="px-6 py-3">Pris</th>
                    <th className="px-6 py-3 text-right">Åtgärder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {ads.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-neutral-500">
                        Inga annonser skapade ännu.
                      </td>
                    </tr>
                  ) : (
                    ads.map((ad) => {
                      const firstImage = ad.Bilder ? ad.Bilder.split(',')[0] : null;
                      return (
                        <tr key={ad.id} className="hover:bg-neutral-50 transition-colors">
                          <td className="px-6 py-4">
                            {firstImage ? (
                              <img src={firstImage} alt="Thumbnail" className="w-12 h-12 object-cover rounded-md border border-neutral-200" />
                            ) : (
                              <div className="w-12 h-12 bg-neutral-100 rounded-md border border-neutral-200 flex items-center justify-center text-neutral-400">
                                Inga
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 font-medium text-neutral-900 max-w-xs truncate" title={ad.Rubrik}>
                            {ad.Rubrik || 'Utan rubrik'}
                          </td>
                          <td className="px-6 py-4 text-neutral-600">
                            {ad.Annonstyp === 'Auction' ? 'Auktion' : ad.Annonstyp === 'FixedPrice' ? 'Fast pris' : 'Butik'}
                          </td>
                          <td className="px-6 py-4 text-neutral-600">
                            {ad.Utropspris ? `${ad.Utropspris} kr` : ad['Köp nu-pris'] ? `${ad['Köp nu-pris']} kr` : '-'}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => editAd(ad)}
                                className="p-2 text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                title="Redigera annons"
                              >
                                <Edit3 size={18} />
                              </button>
                              <button
                                onClick={() => deleteAd(ad.id!)}
                                className="p-2 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                title="Radera annons"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

