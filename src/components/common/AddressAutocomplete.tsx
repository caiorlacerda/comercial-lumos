import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// Carregamento global do script (uma vez por página)
let loadPromise: Promise<void> | null = null;
const loadGoogleMaps = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.reject('SSR');
  // Já carregado
  if ((window as any).google?.maps?.places) return Promise.resolve();
  if (loadPromise) return loadPromise;
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject('Sem API key do Google Maps');

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-gmaps]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject('Erro ao carregar Google Maps'));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&language=pt-BR&region=BR`;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-gmaps', 'true');
    script.onload = () => resolve();
    script.onerror = () => reject('Erro ao carregar Google Maps');
    document.head.appendChild(script);
  });
  return loadPromise;
};

interface AddressAutocompleteProps {
  value: string;
  onChange: (formatted: string, details?: { name?: string }) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Input de endereço com autocomplete via Google Places.
 * Se a API key não estiver configurada, vira um input simples (graceful fallback).
 */
export default function AddressAutocomplete({ value, onChange, placeholder, className }: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setUnavailable(true);
      return;
    }
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return;
        const google = (window as any).google;
        if (!google?.maps?.places) {
          setUnavailable(true);
          return;
        }
        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'name', 'address_components', 'place_id', 'types'],
          componentRestrictions: { country: 'br' },
        });
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          const formatted = place.formatted_address || place.name || inputRef.current?.value || '';
          // Só consideramos o `name` quando é um estabelecimento/POI (hotel, restaurante,
          // ponto turístico, prédio com nome). Para endereços de rua puros, o `name` do Google
          // é só o trecho da rua e não serve como "nome do local".
          const types: string[] = place.types || [];
          const isNamedPlace = types.some(t =>
            t === 'establishment' ||
            t === 'point_of_interest' ||
            t === 'premise' ||
            t === 'lodging' ||
            t === 'tourist_attraction' ||
            t === 'shopping_mall' ||
            t === 'park' ||
            t === 'university' ||
            t === 'school' ||
            t === 'stadium' ||
            t === 'museum'
          );
          onChange(formatted, { name: isNamedPlace ? place.name : undefined });
        });
        autocompleteRef.current = ac;
      })
      .catch(() => setUnavailable(true));

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lumos-text-secondary pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        className={`input-lumos w-full pl-9 ${className || ''}`}
        placeholder={placeholder || (unavailable ? 'Digite o endereço' : 'Comece a digitar o endereço...')}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
