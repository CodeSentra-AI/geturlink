import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Download, Sparkles, LayoutGrid, List, Palette, Info, GripVertical, Upload } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5050';

export default function Editor({ token, username, user }) {
  const [profile, setProfile] = useState({
    displayName: '',
    bio: '',
    avatarUrl: '',
    theme: 'glass-dark',
    customCss: '',
    layoutType: 'grid',
    faqContext: '',
    customDomain: ''
  });

  const [links, setLinks] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeSubTab, setActiveSubTab] = useState('links'); // 'links' | 'store' | 'design'
  const [saveStatus, setSaveStatus] = useState('');

  // Link forms state
  const [newLink, setNewLink] = useState({ title: '', url: '', icon: 'link' });
  // Product forms state
  const [newProduct, setNewProduct] = useState({ title: '', description: '', price: '', fileUrl: '' });

  // Uploading state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingProduct, setUploadingProduct] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Custom premium dropdown states
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [layoutDropdownOpen, setLayoutDropdownOpen] = useState(false);

  useEffect(() => {
    fetchProfileData();
  }, [token]);

  // Click outside to close custom dropdowns
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.relative-dropdown')) {
        setThemeDropdownOpen(false);
        setLayoutDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const fetchProfileData = async () => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      
      const pRes = await fetch(`${API_URL}/api/profile`, { headers });
      const pData = await pRes.json();
      setProfile({
        displayName: pData.display_name || '',
        bio: pData.bio || '',
        avatarUrl: pData.avatar_url || '',
        theme: pData.theme || 'glass-dark',
        customCss: pData.custom_css || '',
        layoutType: pData.layout_type || 'grid',
        faqContext: pData.faq_context || '',
        customDomain: pData.custom_domain || ''
      });

      const lRes = await fetch(`${API_URL}/api/links`, { headers });
      const lData = await lRes.json();
      setLinks(lData);

      const prRes = await fetch(`${API_URL}/api/products`, { headers });
      const prData = await prRes.json();
      setProducts(prData);
    } catch (err) {
      console.error('Failed to load editor config:', err);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    setUploadingAvatar(true);
    setSaveStatus('Uploading avatar...');
    try {
      const response = await fetch(`${API_URL}/api/upload/avatar`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
      if (response.ok) {
        const resData = await response.json();
        setProfile(prev => ({ ...prev, avatarUrl: resData.url }));
        setSaveStatus('Avatar uploaded!');
        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        alert('Avatar upload failed');
        setSaveStatus('Upload failed');
        setTimeout(() => setSaveStatus(''), 2000);
      }
    } catch (err) {
      console.error(err);
      alert('Avatar upload error');
      setSaveStatus('Upload error');
      setTimeout(() => setSaveStatus(''), 2000);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleProductFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('productFile', file);

    setUploadingProduct(true);
    setSaveStatus('Uploading product file...');
    try {
      const response = await fetch(`${API_URL}/api/upload/product`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
      if (response.ok) {
        const resData = await response.json();
        setNewProduct(prev => ({ ...prev, fileUrl: resData.url }));
        setSaveStatus('Product file uploaded!');
        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        alert('Product file upload failed');
        setSaveStatus('Upload failed');
        setTimeout(() => setSaveStatus(''), 2000);
      }
    } catch (err) {
      console.error(err);
      alert('Product file upload error');
      setSaveStatus('Upload error');
      setTimeout(() => setSaveStatus(''), 2000);
    } finally {
      setUploadingProduct(false);
    }
  };

  const handleDragStart = (e, idx) => {
    setDraggedIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = async (e, idx) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === idx) return;

    const reorderedLinks = [...links];
    const [draggedItem] = reorderedLinks.splice(draggedIndex, 1);
    reorderedLinks.splice(idx, 0, draggedItem);
    
    setLinks(reorderedLinks);
    setDraggedIndex(null);

    setSaveStatus('Saving links order...');
    try {
      await Promise.all(
        reorderedLinks.map((link, i) => 
          fetch(`${API_URL}/api/links/${link.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              title: link.title,
              url: link.url,
              icon: link.icon,
              sortOrder: i
            })
          })
        )
      );
      setSaveStatus('Order updated!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error('Failed to update links order:', err);
      setSaveStatus('Order save failed');
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const saveProfileSettings = async () => {
    setSaveStatus('Saving...');
    try {
      const response = await fetch(`${API_URL}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(profile)
      });
      const data = await response.json();
      if (response.ok) {
        setSaveStatus('Saved successfully!');
        setTimeout(() => setSaveStatus(''), 2000);
      } else {
        throw new Error(data.error || 'Save failed');
      }
    } catch (err) {
      setSaveStatus(err.message || 'Error saving profile');
      setTimeout(() => setSaveStatus(''), 4000);
    }
  };

  // ----------------------------------------------------
  // LINKS CRUD HANDLERS
  // ----------------------------------------------------
  const handleAddLink = async (e) => {
    e.preventDefault();
    if (!newLink.title || !newLink.url) return;

    try {
      const response = await fetch(`${API_URL}/api/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ...newLink, sortOrder: links.length })
      });
      if (response.ok) {
        const added = await response.json();
        setLinks(prev => [...prev, added]);
        setNewLink({ title: '', url: '', icon: 'link' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteLink = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/links/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setLinks(prev => prev.filter(l => l.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ----------------------------------------------------
  // PRODUCTS CRUD HANDLERS
  // ----------------------------------------------------
  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!newProduct.title || !newProduct.price) return;

    try {
      const response = await fetch(`${API_URL}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ ...newProduct, price: parseFloat(newProduct.price) })
      });
      if (response.ok) {
        const added = await response.json();
        setProducts(prev => [...prev, added]);
        setNewProduct({ title: '', description: '', price: '', fileUrl: '' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProduct = async (id) => {
    try {
      const response = await fetch(`${API_URL}/api/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setProducts(prev => prev.filter(p => p.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const [exportApiUrl, setExportApiUrl] = useState('https://your-api.railway.app');

  // ----------------------------------------------------
  // 1-CLICK STATIC HTML EXPORTER
  // ----------------------------------------------------
  const handleExportPage = () => {
    const selectedThemeVars = 
      profile.theme === 'glass-dark' ? `
        --bg: radial-gradient(circle at top, #111827, #030712);
        --card-bg: rgba(255, 255, 255, 0.05);
        --card-border: rgba(255, 255, 255, 0.1);
        --card-hover: rgba(255, 255, 255, 0.1);
        --text: #f9fafb;
        --text-muted: #9ca3af;
        --accent: #6366f1;
        --accent-glow: rgba(99, 102, 241, 0.5);
      ` : profile.theme === 'neon-glow' ? `
        --bg: #050508;
        --card-bg: rgba(16, 16, 24, 0.7);
        --card-border: #d946ef;
        --card-hover: rgba(217, 70, 239, 0.2);
        --text: #fdf4ff;
        --text-muted: #e879f9;
        --accent: #d946ef;
        --accent-glow: rgba(217, 70, 239, 0.6);
        --shadow-glow: 0 0 15px rgba(217, 70, 239, 0.4);
      ` : profile.theme === 'cyberpunk' ? `
        --bg: #000;
        --card-bg: #1c1917;
        --card-border: #facc15;
        --card-hover: #facc15;
        --text: #00ff66;
        --text-muted: #facc15;
        --accent: #00ff66;
        --accent-glow: rgba(0, 255, 102, 0.5);
      ` : `
        --bg: linear-gradient(to bottom, #1e1b4b, #31102f);
        --card-bg: rgba(254, 215, 170, 0.08);
        --card-border: rgba(249, 115, 22, 0.3);
        --card-hover: rgba(249, 115, 22, 0.2);
        --text: #ffedd5;
        --text-muted: #fdba74;
        --accent: #f97316;
        --accent-glow: rgba(249, 115, 22, 0.5);
      `;

    // Ensure we strip trailing slash from export API URL
    const sanitizedApiUrl = exportApiUrl.replace(/\/$/, '');

    const staticHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${profile.displayName || username} | GetUrLink (Offline Export)</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      ${selectedThemeVars}
      font-family: 'Outfit', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; transition: all 0.2s ease; }
    body {
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }
    .container { width: 100%; max-width: 580px; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }
    .avatar { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; border: 3px solid var(--accent); }
    .name { font-size: 1.5rem; font-weight: 700; }
    .bio { font-size: 0.95rem; color: var(--text-muted); text-align: center; }
    .links-grid { width: 100%; display: grid; grid-template-columns: ${profile.layoutType === 'grid' ? 'repeat(2, 1fr)' : '1fr'}; gap: 1rem; }
    .bento-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem;
      text-decoration: none;
      color: var(--text);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      backdrop-filter: blur(12px);
    }
    .bento-card:hover { transform: translateY(-4px); border-color: var(--accent); }
    .price { background: var(--accent); color: white; padding: 0.2rem 0.6rem; border-radius: 99px; font-size: 0.75rem; align-self: flex-start; margin-bottom: 0.5rem; }
    .watermark { margin-top: 3rem; font-size: 0.8rem; color: var(--text-muted); opacity: 0.5; text-decoration: none; }
    ${profile.customCss || ''}
  </style>
</head>
<body>
  <div class="container">
    <img src="${profile.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150'}" class="avatar">
    <h1 class="name">${profile.displayName || username}</h1>
    <p class="bio">${profile.bio}</p>

    <!-- Interactive AI Assistant Widget -->
    <div style="width: 100%; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; backdrop-filter: blur(12px);">
      <div style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--accent);">✨ Ask Assistant</div>
      <div id="chatBox" style="max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; padding-right: 0.5rem; font-size: 0.85rem;">
        <div style="padding: 0.75rem; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255,255,255,0.06); align-self: flex-start; line-height: 1.4;">
          Hi! Ask me anything about ${profile.displayName || username}'s digital products or presets.
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <input type="text" id="chatInput" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); color: var(--text); padding: 0.6rem 1rem; border-radius: 12px; font-family: inherit; outline: none;" placeholder="Ask a question...">
        <button style="background: var(--accent); border: none; color: white; padding: 0.6rem 1.25rem; border-radius: 12px; cursor: pointer; font-weight: 600;" onclick="sendMessage()">Ask</button>
      </div>
    </div>

    <div class="links-grid">
      ${links.map(l => `
        <a href="${sanitizedApiUrl}/r/${l.id}?ref=bio" class="bento-card" target="_blank" style="grid-column: span ${profile.layoutType === 'grid' ? '2' : '1'}">
          <div style="font-weight: 600;">${l.title}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${l.url}</div>
        </a>
      `).join('')}
    </div>

    ${products.length > 0 ? `
      <h2 style="font-size: 1.1rem; align-self: flex-start; text-transform: uppercase; color: var(--text-muted); margin-top: 1rem;">Shop Digital</h2>
      <div class="links-grid">
        ${products.map(p => `
          <div class="bento-card" onclick="openCheckout(${p.id}, '${p.title}', ${p.price})" style="cursor:pointer;">
            <span class="price">$${p.price}</span>
            <div style="font-weight: 600;">${p.title}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${p.description || ''}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <a href="https://geturlink.com" class="watermark">Exported via GetUrLink</a>
  </div>

  <!-- Checkout Modal -->
  <div id="checkoutModal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 1000; display: none; align-items: center; justify-content: center; padding: 1rem;">
    <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 2rem; max-width: 440px; width: 100%; display: flex; flex-direction: column; gap: 1.25rem; box-shadow: 0 20px 50px rgba(0,0,0,0.5); color:#fff;">
      <div id="checkoutTitle" style="font-size: 1.25rem; font-weight: 700;">Buy Digital Product</div>
      <p style="color: #94a3b8; font-size: 0.9rem;">Enter your email. Your download link will trigger instantly.</p>
      <input type="email" id="checkoutEmail" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 0.875rem 1.25rem; border-radius: 12px; outline: none; font-family: inherit;" placeholder="yourname@gmail.com" required>
      <button style="background: #10b981; color: white; border: none; padding: 1rem; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 1rem;" onclick="processPayment()">Complete Secure Checkout</button>
      <button style="background: transparent; color: #94a3b8; border: none; cursor: pointer; font-size: 0.9rem; align-self: center;" onclick="closeCheckout()">Cancel</button>
    </div>
  </div>

  <script>
    // Record view analytics
    fetch('${sanitizedApiUrl}/api/public/${username}/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referrer: document.referrer || 'direct' })
    }).catch(err => console.log(err));

    let activeProductId = null;

    function openCheckout(productId, title, price) {
      activeProductId = productId;
      document.getElementById('checkoutTitle').innerText = 'Get ' + title + ' - $' + price;
      document.getElementById('checkoutModal').style.display = 'flex';
      document.getElementById('checkoutEmail').focus();
    }

    function closeCheckout() {
      document.getElementById('checkoutModal').style.display = 'none';
      activeProductId = null;
    }

    async function processPayment() {
      const email = document.getElementById('checkoutEmail').value;
      if (!email || !email.includes('@')) {
        alert('Please enter a valid email.');
        return;
      }
      try {
        const res = await fetch('${sanitizedApiUrl}/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: activeProductId, email })
        });
        const data = await res.json();
        if (data.success) {
          closeCheckout();
          window.location.href = data.checkoutUrl;
        } else {
          alert('Error: ' + data.error);
        }
      } catch (err) {
        alert('Checkout failed.');
      }
    }

    async function sendMessage() {
      const input = document.getElementById('chatInput');
      const query = input.value.trim();
      if (!query) return;

      input.value = '';
      appendMessage(query, 'user');

      const chatBox = document.getElementById('chatBox');
      const loader = document.createElement('div');
      loader.id = 'chatLoader';
      loader.style = 'padding: 0.75rem; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255,255,255,0.06); align-self: flex-start; line-height: 1.4;';
      loader.innerText = 'Thinking...';
      chatBox.appendChild(loader);
      chatBox.scrollTop = chatBox.scrollHeight;

      try {
        const res = await fetch('${sanitizedApiUrl}/api/public/${username}/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        const data = await res.json();
        
        document.getElementById('chatLoader').remove();
        appendMessage(data.answer, 'bot');

        if (data.product) {
          const buyCard = document.createElement('div');
          buyCard.style = 'padding: 0.75rem; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--accent); align-self: flex-start; line-height: 1.4;';
          buyCard.innerHTML = \`
            <div style="font-weight:600;margin-bottom:0.25rem;">\${data.product.title}</div>
            <button onclick="openCheckout(\${data.product.id}, '\${data.product.title}', \${data.product.price})" 
                    style="background:var(--accent);color:#white;border:none;padding:0.4rem 0.8rem;border-radius:6px;font-weight:600;font-size:0.8rem;cursor:pointer;">
              Buy Now for $\${data.product.price}
            </button>
          \`;
          chatBox.appendChild(buyCard);
          chatBox.scrollTop = chatBox.scrollHeight;
        }
      } catch (err) {
        document.getElementById('chatLoader').remove();
        appendMessage('Sorry, chatbot is busy.', 'bot');
      }
    }

    function appendMessage(text, sender) {
      const chatBox = document.getElementById('chatBox');
      const msg = document.createElement('div');
      msg.style = 'padding: 0.75rem; border-radius: 12px; line-height: 1.4; max-width: 85%; font-size: 0.85rem;';
      if (sender === 'user') {
        msg.style.cssText += 'background: var(--accent); color: #fff; align-self: flex-end;';
      } else {
        msg.style.cssText += 'background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255,255,255,0.06); align-self: flex-start;';
      }
      msg.innerText = text;
      chatBox.appendChild(msg);
      chatBox.scrollTop = chatBox.scrollHeight;
    }

    document.getElementById('chatInput').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>`;

    // Trigger local file download
    const element = document.createElement("a");
    const file = new Blob([staticHtmlContent], { type: 'text/html' });
    element.href = URL.createObjectURL(file);
    element.download = `${username}_bio_page.html`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Dynamic Theme Var Generator for Interactive Phone Mockup preview
  const getMockupStyles = () => {
    switch (profile.theme) {
      case 'neon-glow':
        return {
          '--bg': '#050508',
          '--card-bg': 'rgba(16, 16, 24, 0.7)',
          '--card-border': '#d946ef',
          '--text': '#fdf4ff',
          '--text-muted': '#e879f9',
          '--accent': '#d946ef',
          '--accent-glow': 'rgba(217, 70, 239, 0.5)'
        };
      case 'cyberpunk':
        return {
          '--bg': '#000000',
          '--card-bg': '#1c1917',
          '--card-border': '#facc15',
          '--text': '#00ff66',
          '--text-muted': '#facc15',
          '--accent': '#00ff66',
          '--accent-glow': 'rgba(0, 255, 102, 0.3)'
        };
      case 'sunset-glow':
        return {
          '--bg': 'linear-gradient(to bottom, #1e1b4b, #31102f)',
          '--card-bg': 'rgba(254, 215, 170, 0.08)',
          '--card-border': 'rgba(249, 115, 22, 0.3)',
          '--text': '#ffedd5',
          '--text-muted': '#fdba74',
          '--accent': '#f97316',
          '--accent-glow': 'rgba(249, 115, 22, 0.4)'
        };
      case 'aurora-borealis':
        return {
          '--bg': 'linear-gradient(135deg, #022c22, #0f172a, #1e1b4b)',
          '--card-bg': 'rgba(255, 255, 255, 0.04)',
          '--card-border': 'rgba(16, 185, 129, 0.3)',
          '--text': '#f0fdf4',
          '--text-muted': '#a7f3d0',
          '--accent': '#10b981',
          '--accent-glow': 'rgba(16, 185, 129, 0.4)'
        };
      case 'retro-wave':
        return {
          '--bg': 'linear-gradient(to bottom, #11001c, #2d004d, #000000)',
          '--card-bg': 'rgba(255, 0, 127, 0.05)',
          '--card-border': '#ff007f',
          '--text': '#ffffff',
          '--text-muted': '#ff9ebb',
          '--accent': '#ff007f',
          '--accent-glow': 'rgba(255, 0, 127, 0.6)'
        };
      case 'sakura-blossom':
        return {
          '--bg': 'linear-gradient(135deg, #fff1f2, #ffe4e6, #fce7f3)',
          '--card-bg': 'rgba(255, 255, 255, 0.7)',
          '--card-border': 'rgba(251, 113, 133, 0.3)',
          '--text': '#4c0519',
          '--text-muted': '#9f1239',
          '--accent': '#db2777',
          '--accent-glow': 'rgba(219, 39, 119, 0.3)'
        };
      case 'glass-light':
        return {
          '--bg': 'linear-gradient(135deg, #e0e7ff, #f3e8ff, #fdf2f8)',
          '--card-bg': 'rgba(255, 255, 255, 0.35)',
          '--card-border': 'rgba(255, 255, 255, 0.6)',
          '--text': '#1e1b4b',
          '--text-muted': '#4f46e5',
          '--accent': '#6366f1',
          '--accent-glow': 'rgba(99, 102, 241, 0.25)'
        };
      case 'glass-dark':
      default:
        return {
          '--bg': 'radial-gradient(circle at top, #111827, #030712)',
          '--card-bg': 'rgba(255, 255, 255, 0.05)',
          '--card-border': 'rgba(255, 255, 255, 0.1)',
          '--text': '#f9fafb',
          '--text-muted': '#9ca3af',
          '--accent': '#6366f1',
          '--accent-glow': 'rgba(99, 102, 241, 0.4)'
        };
    }
  };

  return (
    <div className="editor-layout animate-fade-in">
      
      {/* Editor Left Column: Config Panel */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '800' }}>Customize Profile</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Set up your visual page parameters.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {saveStatus && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{saveStatus}</span>}
            <button onClick={saveProfileSettings} className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
              <Save size={16} /> Save Setup
            </button>
          </div>
        </div>

        {/* Input Details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label className="label-text">Display Name</label>
            <input 
              type="text" 
              name="displayName" 
              className="input-field" 
              value={profile.displayName} 
              onChange={handleProfileChange}
            />
          </div>
          <div>
            <label className="label-text">Avatar Image</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                type="text" 
                name="avatarUrl" 
                className="input-field" 
                placeholder="Image URL"
                value={profile.avatarUrl} 
                onChange={handleProfileChange}
              />
              <label className="btn-secondary" style={{ padding: '0 0.75rem', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', margin: 0 }} title="Upload Avatar File">
                <Upload size={16} />
                <input 
                  type="file" 
                  accept="image/*" 
                  style={{ display: 'none' }} 
                  onChange={handleAvatarUpload} 
                  disabled={uploadingAvatar}
                />
              </label>
            </div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label className="label-text">Bio / Description</label>
            <textarea 
              name="bio" 
              rows="2" 
              className="input-field" 
              style={{ resize: 'none' }}
              value={profile.bio} 
              onChange={handleProfileChange}
            />
          </div>
        </div>

        {/* Sub-tabs selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem', gap: '1rem' }}>
          {['links', 'store', 'design'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSubTab(tab)}
              style={{
                background: 'none',
                border: 'none',
                color: activeSubTab === tab ? 'var(--accent-primary)' : 'var(--text-muted)',
                fontWeight: '600',
                fontSize: '0.9rem',
                cursor: 'pointer',
                paddingBottom: '0.25rem',
                borderBottom: activeSubTab === tab ? '2px solid var(--accent-primary)' : 'none',
                textTransform: 'uppercase',
                fontFamily: 'inherit'
              }}
            >
              {tab === 'links' ? 'Links' : tab === 'store' ? 'Digital Store' : 'Design & FAQ'}
            </button>
          ))}
        </div>

        {/* Tab 1: Links Configuration */}
        {activeSubTab === 'links' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <form onSubmit={handleAddLink} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Add New Link</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Link Title" 
                  value={newLink.title} 
                  onChange={(e) => setNewLink(prev => ({ ...prev, title: e.target.value }))}
                />
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Destination URL" 
                  value={newLink.url} 
                  onChange={(e) => setNewLink(prev => ({ ...prev, url: e.target.value }))}
                />
                <button type="submit" className="btn-primary" style={{ padding: '0' }} title="Add Link">
                  <Plus size={20} />
                </button>
              </div>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label className="label-text">Current Active Links</label>
              {links.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>No links configured. Add one above.</div>
              ) : (
                links.map((l, idx) => (
                  <div 
                    key={l.id} 
                    draggable 
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={() => setDraggedIndex(null)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '0.75rem 1rem', 
                      background: 'rgba(255,255,255,0.02)', 
                      border: '1px solid rgba(255,255,255,0.04)', 
                      borderRadius: '12px',
                      cursor: 'grab',
                      userSelect: 'none',
                      transition: 'border-color 0.2s, background-color 0.2s, opacity 0.2s',
                      opacity: draggedIndex === idx ? 0.4 : 1,
                      borderColor: draggedIndex === idx ? 'var(--accent-primary)' : 'rgba(255,255,255,0.04)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <GripVertical size={16} style={{ color: 'var(--text-muted)', cursor: 'grab' }} />
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{l.title}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.url}</div>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteLink(l.id)} className="btn-danger" style={{ padding: '0.35rem' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Digital Storefront Configuration */}
        {activeSubTab === 'store' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <form onSubmit={handleAddProduct} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Add Storefront Product</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Product Title"
                  value={newProduct.title}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, title: e.target.value }))}
                />
                <input 
                  type="number" 
                  step="0.01"
                  className="input-field" 
                  placeholder="Price ($)"
                  value={newProduct.price}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, price: e.target.value }))}
                />
              </div>
              <input 
                type="text" 
                className="input-field" 
                placeholder="Brief Description (e.g. 10 Lightroom presets)"
                value={newProduct.description}
                onChange={(e) => setNewProduct(prev => ({ ...prev, description: e.target.value }))}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Product Filename or URL (e.g. presets.zip)"
                  value={newProduct.fileUrl}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, fileUrl: e.target.value }))}
                />
                <label className="btn-secondary" style={{ padding: '0 0.75rem', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', margin: 0 }} title="Upload Digital Product File">
                  <Upload size={16} />
                  <input 
                    type="file" 
                    style={{ display: 'none' }} 
                    onChange={handleProductFileUpload} 
                    disabled={uploadingProduct}
                  />
                </label>
              </div>
              <button type="submit" className="btn-primary" style={{ height: '38px' }}>
                <Plus size={16} /> Add Product to Store
              </button>
            </form>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label className="label-text">Products Listed</label>
              {products.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>No products listed yet.</div>
              ) : (
                products.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{p.title} <span style={{ color: 'var(--accent-success)' }}>(${p.price.toFixed(2)})</span></div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.description || 'No description'}</div>
                    </div>
                    <button onClick={() => handleDeleteProduct(p.id)} className="btn-danger" style={{ padding: '0.35rem' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Design Presets & AI Shop Assistant Configuration */}
        {activeSubTab === 'design' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            
            {/* Theme & Layout Custom Dropdown Selectors */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              
              {/* Theme Dropdown */}
              <div className="relative-dropdown" style={{ position: 'relative' }}>
                <label className="label-text">
                  <Palette size={12} style={{ display: 'inline', marginRight: '0.2rem' }} /> Theme Selection
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setThemeDropdownOpen(!themeDropdownOpen);
                    setLayoutDropdownOpen(false);
                  }}
                  className="input-field"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    width: '100%',
                    height: '42px',
                    padding: '0.5rem 1rem',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: '0.95rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: 
                        profile.theme === 'glass-dark' ? 'radial-gradient(circle at top, #111827, #030712)' :
                        profile.theme === 'neon-glow' ? '#050508' :
                        profile.theme === 'cyberpunk' ? '#000000' :
                        profile.theme === 'sunset-glow' ? 'linear-gradient(to bottom, #1e1b4b, #31102f)' :
                        profile.theme === 'aurora-borealis' ? 'linear-gradient(135deg, #022c22, #0f172a)' :
                        profile.theme === 'retro-wave' ? 'linear-gradient(to bottom, #11001c, #2d004d)' :
                        profile.theme === 'sakura-blossom' ? 'linear-gradient(135deg, #fff1f2, #ffe4e6)' :
                        'linear-gradient(135deg, #e0e7ff, #f3e8ff)',
                      border: '1px solid rgba(255,255,255,0.2)'
                    }}></div>
                    <span>
                      {profile.theme === 'glass-dark' && 'Glassmorphism Dark'}
                      {profile.theme === 'neon-glow' && 'Neon Glow Cyber'}
                      {profile.theme === 'cyberpunk' && 'Cyberpunk Grid'}
                      {profile.theme === 'sunset-glow' && 'Sunset Silhouette'}
                      {profile.theme === 'aurora-borealis' && 'Aurora Borealis'}
                      {profile.theme === 'retro-wave' && 'Retro Wave 80s'}
                      {profile.theme === 'sakura-blossom' && 'Sakura Blossom'}
                      {profile.theme === 'glass-light' && 'Glassmorphism Light'}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>▼</span>
                </button>

                {themeDropdownOpen && (
                  <div
                    className="glass-panel animate-fade-in"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '0.5rem',
                      zIndex: 999,
                      maxHeight: '220px',
                      overflowY: 'auto',
                      padding: '0.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      background: '#151d30',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.6)'
                    }}
                  >
                    {[
                      { value: 'glass-dark', label: 'Glassmorphism Dark', preview: 'radial-gradient(circle at top, #111827, #030712)' },
                      { value: 'neon-glow', label: 'Neon Glow Cyber', preview: '#050508' },
                      { value: 'cyberpunk', label: 'Cyberpunk Grid', preview: '#000000' },
                      { value: 'sunset-glow', label: 'Sunset Silhouette', preview: 'linear-gradient(to bottom, #1e1b4b, #31102f)' },
                      { value: 'aurora-borealis', label: 'Aurora Borealis', preview: 'linear-gradient(135deg, #022c22, #0f172a)' },
                      { value: 'retro-wave', label: 'Retro Wave 80s', preview: 'linear-gradient(to bottom, #11001c, #2d004d)' },
                      { value: 'sakura-blossom', label: 'Sakura Blossom', preview: 'linear-gradient(135deg, #fff1f2, #ffe4e6)' },
                      { value: 'glass-light', label: 'Glassmorphism Light', preview: 'linear-gradient(135deg, #e0e7ff, #f3e8ff)' }
                    ].map(t => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => {
                          setProfile(prev => ({ ...prev, theme: t.value }));
                          setThemeDropdownOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          width: '100%',
                          padding: '0.6rem 0.75rem',
                          border: 'none',
                          background: profile.theme === t.value ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'background-color 0.2s'
                        }}
                        className="dropdown-item-hover"
                      >
                        <div style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: t.preview,
                          border: '1px solid rgba(255,255,255,0.2)'
                        }}></div>
                        <span style={{ fontSize: '0.9rem', fontWeight: profile.theme === t.value ? '600' : '400' }}>{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Layout Dropdown */}
              <div className="relative-dropdown" style={{ position: 'relative' }}>
                <label className="label-text">
                  <Palette size={12} style={{ display: 'inline', marginRight: '0.2rem' }} /> Layout Type
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setLayoutDropdownOpen(!layoutDropdownOpen);
                    setThemeDropdownOpen(false);
                  }}
                  className="input-field"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    width: '100%',
                    height: '42px',
                    padding: '0.5rem 1rem',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontFamily: 'inherit',
                    fontSize: '0.95rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {profile.layoutType === 'grid' ? <LayoutGrid size={16} /> : <List size={16} />}
                    <span>{profile.layoutType === 'grid' ? 'Modular Grid (Bento)' : 'Standard List (Vertical)'}</span>
                  </div>
                  <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>▼</span>
                </button>

                {layoutDropdownOpen && (
                  <div
                    className="glass-panel animate-fade-in"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '0.5rem',
                      zIndex: 999,
                      padding: '0.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      background: '#151d30',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.6)'
                    }}
                  >
                    {[
                      { value: 'grid', label: 'Modular Grid (Bento)', icon: <LayoutGrid size={16} /> },
                      { value: 'list', label: 'Standard List (Vertical)', icon: <List size={16} /> }
                    ].map(l => (
                      <button
                        key={l.value}
                        type="button"
                        onClick={() => {
                          setProfile(prev => ({ ...prev, layoutType: l.value }));
                          setLayoutDropdownOpen(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          width: '100%',
                          padding: '0.6rem 0.75rem',
                          border: 'none',
                          background: profile.layoutType === l.value ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          transition: 'background-color 0.2s'
                        }}
                        className="dropdown-item-hover"
                      >
                        {l.icon}
                        <span style={{ fontSize: '0.9rem', fontWeight: profile.layoutType === l.value ? '600' : '400' }}>{l.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* AI Assistant Context */}
            <div>
              <label className="label-text" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Sparkles size={14} color="var(--accent-primary)" /> AI Shop Assistant Knowledge Base
              </label>
              <textarea
                name="faqContext"
                rows="4"
                className="input-field"
                style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}
                placeholder="Add information about your products, pricing, or details so the interactive public AI assistant knows how to respond..."
                value={profile.faqContext}
                onChange={handleProfileChange}
              />
            </div>

            {/* Custom CSS overrides */}
            <div>
              <label className="label-text" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Palette size={14} /> Custom CSS Overrides
              </label>
              <textarea
                name="customCss"
                rows="3"
                className="input-field"
                style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}
                placeholder="/* e.g., body { font-family: monospace; } */"
                value={profile.customCss}
                onChange={handleProfileChange}
              />
            </div>

            {/* Custom Domain Mapping */}
            <div>
              <label className="label-text" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Info size={14} /> Custom Domain Mapping
              </label>
              {user?.isPremium ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <input
                    type="text"
                    name="customDomain"
                    className="input-field"
                    placeholder="e.g. bio.yourdomain.com"
                    value={profile.customDomain}
                    onChange={handleProfileChange}
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Map your own domain directly to this profile! Point a CNAME DNS record for your subdomain to this hosting address.
                  </p>
                </div>
              ) : (
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--accent-primary)' }}>Custom Domain Mapping</span>
                    <span style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontWeight: '700' }}>PREMIUM ONLY</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    Serve your page directly at your own domain (e.g., bio.yourname.com) instead of geturlink.com/p/username. Upgrade to Premium to unlock custom domain support.
                  </p>
                </div>
              )}
            </div>

            {/* Portable Export Feature */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.25rem' }}>
              <div style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '600', fontSize: '0.9rem' }}>
                  <Info size={16} color="var(--accent-primary)" /> Own Your Data (Portability Export)
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Download your profile as a fully-designed, self-contained, lightweight offline HTML file. You can upload this directly to your own server, Netlify, or GitHub Pages.
                </p>
                <div>
                  <label className="label-text" style={{ fontSize: '0.75rem', marginBottom: '0.2rem' }}>Production Backend API URL</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem', marginBottom: '0.5rem' }} 
                    placeholder="https://your-api.railway.app" 
                    value={exportApiUrl}
                    onChange={(e) => setExportApiUrl(e.target.value)}
                  />
                </div>
                <button onClick={handleExportPage} className="btn-secondary" style={{ borderStyle: 'dashed', borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', justifyContent: 'center' }}>
                  <Download size={16} /> Export Standalone HTML Page
                </button>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* Editor Right Column: Sticky Simulator Preview */}
      <div className="phone-preview-column">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
          
          <div className="phone-mockup" style={getMockupStyles()}>
            <div className="phone-camera-notch"></div>
            <div className="phone-screen-content" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
              
              {/* Mock Avatar */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', textAlign: 'center', marginTop: '1rem' }}>
                <img 
                  src={profile.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150'} 
                  alt="Avatar"
                  style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)', boxShadow: '0 0 10px var(--accent)' }}
                />
                <div style={{ fontWeight: '700', fontSize: '1.25rem' }}>{profile.displayName || 'Display Name'}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '240px', whiteSpace: 'normal', overflowWrap: 'break-word' }}>{profile.bio || 'Your bio details go here...'}</div>
              </div>

              {/* Mock AI Widget */}
              <div style={{ width: '100%', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: '12px', padding: '0.75rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--accent)' }}>✨ Ask My AI Assistant</div>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.4rem 0.6rem', borderRadius: '8px', fontSize: '0.7rem', color: 'var(--text)' }}>
                  Ask me questions about presets or files!
                </div>
              </div>

              {/* Links List / Grid Mock */}
              <div style={{ alignSelf: 'flex-start', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '0.5rem' }}>Links</div>
              <div style={{ 
                width: '100%', 
                display: 'grid', 
                gridTemplateColumns: profile.layoutType === 'grid' ? 'repeat(2, 1fr)' : '1fr', 
                gap: '0.75rem' 
              }}>
                {links.length === 0 ? (
                  <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: '1rem', border: '1px dashed var(--card-border)', borderRadius: '12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>No links added yet.</div>
                ) : (
                  links.map(l => (
                    <div 
                      key={l.id} 
                      style={{ 
                        background: 'var(--card-bg)', 
                        border: '1px solid var(--card-border)', 
                        borderRadius: '12px', 
                        padding: '0.75rem',
                        gridColumn: profile.layoutType === 'grid' ? 'span 1' : 'span 2',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center'
                      }}
                    >
                      <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text)' }}>{l.title}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{l.url}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Shop List / Grid Mock */}
              {products.length > 0 && (
                <>
                  <div style={{ alignSelf: 'flex-start', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '0.5rem' }}>Digital Products</div>
                  <div style={{ 
                    width: '100%', 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(2, 1fr)', 
                    gap: '0.75rem' 
                  }}>
                    {products.map(p => (
                      <div 
                        key={p.id} 
                        style={{ 
                          background: 'var(--card-bg)', 
                          border: '1px solid var(--card-border)', 
                          borderRadius: '12px', 
                          padding: '0.75rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                          position: 'relative'
                        }}
                      >
                        <span style={{ background: 'var(--accent)', color: 'white', fontSize: '0.65rem', fontWeight: '600', padding: '0.1rem 0.4rem', borderRadius: '99px', alignSelf: 'flex-start' }}>${p.price}</span>
                        <div style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text)', marginTop: '0.25rem' }}>{p.title}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineBreak: 'auto', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>{p.description}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

            </div>
          </div>

          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>Live Interactive Mobile Mockup</span>
        </div>
      </div>

    </div>
  );
}
