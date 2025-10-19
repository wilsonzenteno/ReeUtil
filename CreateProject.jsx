// src/pages/CreateProject.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Stepper from '../components/Stepper';
import Step1Details from '../components/CreateProject/Step1Details';
import Step2Financing from '../components/CreateProject/Step2Financing';
import Step3Confirm from '../components/CreateProject/Step3Confirm';

import { db, storage, auth } from '../firebaseConfig';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const toKeywords = (str = '') =>
  str.toLowerCase().split(/[\s,.;:!¡¿?]+/).filter(Boolean).slice(0, 20);

export default function CreateProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [projectData, setProjectData] = useState({
    title: '',
    description: '',
    imageFile: null,
    tags: '',
    brechas: [{ id: Date.now(), title: 'Desarrollo MVP', monto: 0 }],
    metaTotal: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleNext = (newData) => {
    setProjectData(prev => {
      const merged = { ...prev, ...newData };
      if (Array.isArray(merged.brechas)) {
        merged.metaTotal = merged.brechas.reduce((acc, b) => acc + Number(b.monto || 0), 0);
      }
      return merged;
    });
    setStep(s => Math.min(3, s + 1));
  };

  // --- Botón de prueba de subida (para aislar problemas de Storage) ---
  async function testUpload() {
    try {
      console.log('Storage instance:', storage);
      const testRef = ref(storage, `test/${Date.now()}.txt`);
      const blob = new Blob(['hola CREW'], { type: 'text/plain' });
      await uploadBytes(testRef, blob);
      alert('OK test upload');
    } catch (e) {
      console.error('testUpload error:', e);
      alert('Fallo test upload: ' + (e?.message || e));
    }
  }

  const uploadImage = async (file) => {
    console.log('imageFile:', file, 'isFile?', file instanceof File);
    const uid = auth.currentUser?.uid || 'anon';
    const path = `project_images/${uid}_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return url;
  };

  const handlePublish = async () => {
    setLoading(true);
    setError('');
    try {
      if (!auth.currentUser) throw new Error('Debes iniciar sesión para publicar.');
      if (!projectData.title?.trim()) throw new Error('El título es obligatorio.');
      if (!projectData.description?.trim()) throw new Error('La descripción es obligatoria.');
      if (!projectData.imageFile) throw new Error('La imagen del proyecto es obligatoria.');
      if (!Array.isArray(projectData.brechas) || projectData.brechas.length === 0) {
        throw new Error('Debes definir al menos una brecha de financiación.');
      }

      // 1) Subir imagen (si aquí falla, el problema es Storage o que imageFile no es File)
      const imageUrl = await uploadImage(projectData.imageFile);

      // 2) Normalizar tags y keywords
      const tagsArray = (projectData.tags || '')
        .split(/[,\s]+/)
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      const metaTotal = projectData.metaTotal ||
        projectData.brechas.reduce((acc, b) => acc + Number(b.monto || 0), 0);
      const searchKeywords = Array.from(new Set([
        ...toKeywords(projectData.title),
        ...toKeywords(projectData.description),
        ...tagsArray,
      ])).slice(0, 20);

      // 3) Crear proyecto
      const creatorId = auth.currentUser.uid;
      const docRef = await addDoc(collection(db, 'proyectos'), {
        titulo: projectData.title,
        descripcion: projectData.description,
        tags: tagsArray,
        imagenURL: imageUrl,
        creadorID: creatorId,
        brechas: projectData.brechas.map((b, idx) => ({
          id: b.id || `${idx}-${Date.now()}`,
          title: b.title || `Brecha ${idx + 1}`,
          monto: Number(b.monto || 0),
        })),
        metaTotal,
        recaudado: 0,
        estado: 'Publicado',
        ratingAvg: 0,
        ratingCount: 0,
        projectWalletBalance: 0,
        withdrawableBalance: 0,
        searchKeywords,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      alert('¡Proyecto publicado exitosamente!');
      navigate(`/proyectos/${docRef.id}`); // vamos al detalle para seguir el flujo
    } catch (err) {
      console.error('Error al publicar:', err);
      setError(err.message || 'Error al publicar el proyecto.');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1: return <Step1Details data={projectData} onNext={handleNext} />;
      case 2: return <Step2Financing data={projectData} onNext={handleNext} onBack={() => setStep(1)} />;
      case 3: return (
        <div>
          <Step3Confirm
            data={projectData}
            onPublish={handlePublish}
            onBack={() => setStep(2)}
            loading={loading}
          />
          {/* botón temporal de diagnóstico */}
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={testUpload}>Test upload (diagnóstico)</button>
          </div>
        </div>
      );
      default: return <div>Paso no encontrado.</div>;
    }
  };

  return (
    <div style={styles.container}>
      <Stepper currentStep={step} />
      {error && <p style={styles.error}>{error}</p>}
      {renderStep()}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '900px',
    margin: '40px auto',
    padding: '20px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
  },
  error: {
    color: '#b91c1c',
    padding: '10px',
    backgroundColor: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    marginBottom: '16px',
  },
};
