import { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import {
  X,
  Download,
  CheckCircle2,
  Loader2,
  HardDrive,
  Cpu,
  MemoryStick,
  Upload,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import type { OSImage, VMResourceConfig } from '../types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface VMCreateWizardProps {
  onClose: () => void;
  onCreated: () => void;
}

type Step = 'os' | 'resources' | 'review';

const DISTRO_ICONS: Record<string, string> = {
  ubuntu: '🟠',
  debian: '🔴',
  fedora: '🔵',
  linuxmint: '🟢',
  custom: '📀',
};

export function VMCreateWizard({ onClose, onCreated }: VMCreateWizardProps) {
  const { vmImageDownloadProgress, setVmImageDownloadProgress } = useAppStore();

  const [step, setStep] = useState<Step>('os');
  const [availableImages, setAvailableImages] = useState<OSImage[]>([]);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<OSImage | null>(null);
  const [vmName, setVmName] = useState('');
  const [resources, setResources] = useState<VMResourceConfig>({
    cpuCount: 2,
    memoryMb: 4096,
    diskSizeGb: 25,
    displayMode: 'separate_window',
    vramMb: 128,
    enableEFI: true,
  });
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available images
  useEffect(() => {
    if (!isElectron) return;
    (async () => {
      const images = await window.electronAPI.vm.getAvailableImages();
      setAvailableImages(images);
      const downloaded = await window.electronAPI.vm.getDownloadedImages();
      setDownloadedIds(new Set(downloaded.map((img: OSImage) => img.id)));
    })();
  }, []);

  // Auto-generate VM name from selected image
  useEffect(() => {
    if (selectedImage && !vmName) {
      setVmName(selectedImage.name);
    }
  }, [selectedImage]);

  // Apply minimum requirements from selected image
  useEffect(() => {
    if (selectedImage) {
      setResources(prev => ({
        ...prev,
        diskSizeGb: Math.max(prev.diskSizeGb, selectedImage.minDiskGb),
        memoryMb: Math.max(prev.memoryMb, selectedImage.minMemoryMb),
      }));
    }
  }, [selectedImage]);

  const downloadImage = async (image: OSImage) => {
    setDownloading(true);
    setError(null);
    try {
      const result = await window.electronAPI.vm.downloadImage(image.id);
      if (result.success) {
        setDownloadedIds(prev => new Set([...prev, image.id]));
      } else {
        setError(result.error || 'Download failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
      setVmImageDownloadProgress(null);
    }
  };

  const importISO = async () => {
    try {
      const image = await window.electronAPI.vm.importISO();
      if (image) {
        setAvailableImages(prev => [...prev, image]);
        setDownloadedIds(prev => new Set([...prev, image.id]));
        setSelectedImage(image);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const createVM = async () => {
    if (!selectedImage) return;
    setCreating(true);
    setError(null);
    try {
      const result = await window.electronAPI.vm.createVM({
        name: vmName || selectedImage.name,
        osImageId: selectedImage.id,
        resources,
      });
      if (result.success) {
        onCreated();
      } else {
        setError(result.error || 'Failed to create VM');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create VM');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Create Virtual Machine</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              {step === 'os' && 'Step 1: Choose an operating system'}
              {step === 'resources' && 'Step 2: Configure resources'}
              {step === 'review' && 'Step 3: Review and create'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-text-secondary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Step 1: Choose OS */}
          {step === 'os' && (
            <div className="space-y-3">
              {availableImages.map((image) => {
                const isDownloaded = downloadedIds.has(image.id);
                const isSelected = selectedImage?.id === image.id;
                const isDownloadingThis = downloading && vmImageDownloadProgress?.imageId === image.id;

                return (
                  <button
                    key={image.id}
                    onClick={() => {
                      if (isDownloaded) {
                        setSelectedImage(image);
                      } else if (!downloading) {
                        downloadImage(image);
                      }
                    }}
                    disabled={downloading && !isDownloadingThis}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-border-hover bg-surface-hover/30'
                    } disabled:opacity-40`}
                  >
                    <span className="text-2xl">{DISTRO_ICONS[image.distro] || '🐧'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary">{image.name}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">
                        {formatBytes(image.fileSize)} &middot; {image.arch}
                        {image.minMemoryMb && ` &middot; ${image.minMemoryMb / 1024} GB RAM min`}
                      </p>
                      {isDownloadingThis && vmImageDownloadProgress && (
                        <div className="mt-2">
                          <div className="w-full bg-blue-500/20 rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full transition-all"
                              style={{ width: `${vmImageDownloadProgress.percent}%` }}
                            />
                          </div>
                          <p className="text-xs text-blue-400 mt-1">
                            {vmImageDownloadProgress.percent}% — {formatBytes(vmImageDownloadProgress.bytesDownloaded)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0">
                      {isDownloaded ? (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle2 className="w-4 h-4" />
                          {isSelected ? 'Selected' : 'Ready'}
                        </span>
                      ) : isDownloadingThis ? (
                        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-text-secondary">
                          <Download className="w-4 h-4" />
                          Download
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Import ISO button */}
              <button
                onClick={importISO}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-dashed border-border hover:border-border-hover transition-all text-left"
              >
                <span className="text-2xl">📀</span>
                <div className="flex-1">
                  <p className="font-medium text-text-primary">Import Custom ISO</p>
                  <p className="text-xs text-text-tertiary mt-0.5">Use your own ISO image file</p>
                </div>
                <Upload className="w-5 h-5 text-text-secondary" />
              </button>
            </div>
          )}

          {/* Step 2: Configure Resources */}
          {step === 'resources' && (
            <div className="space-y-6">
              {/* VM Name */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">VM Name</label>
                <input
                  type="text"
                  value={vmName}
                  onChange={(e) => setVmName(e.target.value)}
                  placeholder={selectedImage?.name || 'My Virtual Machine'}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
                />
              </div>

              {/* CPU */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <Cpu className="w-4 h-4 text-text-secondary" />
                    CPUs
                  </label>
                  <span className="text-sm font-mono text-accent">{resources.cpuCount}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={16}
                  value={resources.cpuCount}
                  onChange={(e) => setResources(prev => ({ ...prev, cpuCount: parseInt(e.target.value) }))}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between text-xs text-text-tertiary mt-1">
                  <span>1</span>
                  <span>16</span>
                </div>
              </div>

              {/* Memory */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <MemoryStick className="w-4 h-4 text-text-secondary" />
                    Memory
                  </label>
                  <span className="text-sm font-mono text-accent">{resources.memoryMb / 1024} GB</span>
                </div>
                <input
                  type="range"
                  min={512}
                  max={32768}
                  step={512}
                  value={resources.memoryMb}
                  onChange={(e) => setResources(prev => ({ ...prev, memoryMb: parseInt(e.target.value) }))}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between text-xs text-text-tertiary mt-1">
                  <span>512 MB</span>
                  <span>32 GB</span>
                </div>
              </div>

              {/* Disk */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                    <HardDrive className="w-4 h-4 text-text-secondary" />
                    Disk Size
                  </label>
                  <span className="text-sm font-mono text-accent">{resources.diskSizeGb} GB</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={500}
                  step={5}
                  value={resources.diskSizeGb}
                  onChange={(e) => setResources(prev => ({ ...prev, diskSizeGb: parseInt(e.target.value) }))}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between text-xs text-text-tertiary mt-1">
                  <span>10 GB</span>
                  <span>500 GB</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 'review' && selectedImage && (
            <div className="space-y-4">
              <div className="bg-background rounded-xl border border-border p-5">
                <h3 className="text-sm font-medium text-text-secondary mb-3">Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Name</span>
                    <span className="text-sm font-medium text-text-primary">{vmName || selectedImage.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Operating System</span>
                    <span className="text-sm font-medium text-text-primary">{selectedImage.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">CPUs</span>
                    <span className="text-sm font-medium text-text-primary">{resources.cpuCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Memory</span>
                    <span className="text-sm font-medium text-text-primary">{resources.memoryMb / 1024} GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Disk</span>
                    <span className="text-sm font-medium text-text-primary">{resources.diskSizeGb} GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-secondary">Display</span>
                    <span className="text-sm font-medium text-text-primary">Separate Window</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-text-tertiary">
                The VM will be created and registered with VirtualBox. Start it to begin the OS installation.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <button
            onClick={() => {
              if (step === 'resources') setStep('os');
              else if (step === 'review') setStep('resources');
              else onClose();
            }}
            className="flex items-center gap-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 'os' ? 'Cancel' : 'Back'}
          </button>

          {step === 'os' && (
            <button
              onClick={() => setStep('resources')}
              disabled={!selectedImage}
              className="flex items-center gap-1 px-5 py-2.5 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {step === 'resources' && (
            <button
              onClick={() => setStep('review')}
              className="flex items-center gap-1 px-5 py-2.5 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          )}

          {step === 'review' && (
            <button
              onClick={createVM}
              disabled={creating}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create VM'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
