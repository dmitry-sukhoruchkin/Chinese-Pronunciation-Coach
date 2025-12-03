import React, { useState, useRef, useEffect, useCallback } from 'react';

// === КОНФИГУРАЦИЯ ===
// Текст песни "Tao Hua Nuo" (первые строки)
const SONG_LYRICS = "初见若缱绻誓言风吹云舒卷岁月间问今夕又何年";
const CHAR_DATA = SONG_LYRICS.split('').map(c => ({ char: c }));

// Настройки рисования
const SETTINGS = {
    CANVAS_SIZE: 300, // Размер холста (внутренний)
    TOLERANCE: 60,    // Насколько криво можно рисовать (чем больше, тем легче)
    BRUSH_WIDTH: 15,  // Толщина кисти пользователя
};

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

// Получаем координаты (X, Y) из события мыши или тача
const getCoords = (e: any, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Масштабируем координаты экрана в координаты канваса (1024x1024 - стандарт HanziWriter)
    const scaleX = 1024 / rect.width;
    const scaleY = 1024 / rect.height;
    
    return {
        x: (clientX - rect.left) * scaleX,
        y: 1024 - (clientY - rect.top) * scaleY // Инвертируем Y для данных HanziWriter
    };
};

// Простой алгоритм проверки: Начало, Середина, Конец
const checkStrokeMatch = (userPoints: {x:number, y:number}[], targetPathStr: string) => {
    if (userPoints.length < 5) return false; // Слишком короткий мазок

    // Создаем невидимый элемент для математики пути
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", targetPathStr);
    const len = path.getTotalLength();

    // Точки идеального пути
    const startTarget = path.getPointAtLength(0);
    const midTarget = path.getPointAtLength(len / 2);
    const endTarget = path.getPointAtLength(len);

    // Точки пользователя
    const startUser = userPoints[0];
    const endUser = userPoints[userPoints.length - 1];
    // Ищем ближайшую точку пользователя к середине идеала
    const midUser = userPoints.reduce((prev, curr) => {
        const distPrev = Math.hypot(prev.x - midTarget.x, prev.y - midTarget.y);
        const distCurr = Math.hypot(curr.x - midTarget.x, curr.y - midTarget.y);
        return distCurr < distPrev ? curr : prev;
    });

    // Дистанция (Пифагор)
    const distStart = Math.hypot(startUser.x - startTarget.x, startUser.y - startTarget.y);
    const distEnd = Math.hypot(endUser.x - endTarget.x, endUser.y - endTarget.y);
    const distMid = Math.hypot(midUser.x - midTarget.x, midUser.y - midTarget.y);

    // Проверка (Допуск SETTINGS.TOLERANCE * масштаб)
    // Умножаем на 2, чтобы на телефоне было легче попасть
    const limit = SETTINGS.TOLERANCE * 2.5; 

    return (distStart < limit && distEnd < limit && distMid < limit);
};


export default function App() {
    // --- STATE ---
    const [globalIndex, setGlobalIndex] = useState(0);
    const [stage, setStage] = useState<'audio' | 'writing'>('audio'); // Этап: Слушать или Писать
    
    // Audio State
    const [isListening, setIsListening] = useState(false);
    const [audioStatus, setAudioStatus] = useState<'idle' | 'success' | 'fail'>('idle');
    const [recognizedText, setRecognizedText] = useState('');

    // Writing State
    const [charData, setCharData] = useState<any>(null); // Данные JSON
    const [strokeIndex, setStrokeIndex] = useState(0);   // Текущая черта
    const [userPath, setUserPath] = useState<{x:number, y:number}[]>([]); // Текущий рисунок
    const [writeStatus, setWriteStatus] = useState<'drawing' | 'success'>('drawing');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawing = useRef(false);
    
    const currentChar = CHAR_DATA[globalIndex].char;

    // 1. ЗАГРУЗКА ДАННЫХ ИЕРОГЛИФА
    useEffect(() => {
        const load = async () => {
            setCharData(null);
            setStrokeIndex(0);
            setWriteStatus('drawing');
            setAudioStatus('idle');
            setRecognizedText('');
            // Если включим аудио первым, раскомментируй:
            // setStage('audio'); 
            // Для тестов пока сразу письмо, или как скажешь. 
            // Но ты просил "сначала произношение".
            setStage('audio'); 

            try {
                const res = await fetch(`https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${currentChar}.json`);
                const data = await res.json();
                setCharData(data);
            } catch (e) {
                console.error("Ошибка загрузки иероглифа", e);
            }
        };
        load();
    }, [globalIndex]);

    // 2. АУДИО ФУНКЦИИ
    const playAudio = () => {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(currentChar);
        u.lang = 'zh-CN';
        u.rate = 0.8;
        window.speechSynthesis.speak(u);
    };

    const startListening = () => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Ваш браузер не поддерживает распознавание речи. Используйте Chrome/Safari.");
            // Skip audio step fallback
            setStage('writing');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 5;

        setIsListening(true);
        setAudioStatus('idle');
        setRecognizedText('Listening...');

        recognition.onresult = (event: any) => {
            const result = event.results[0][0].transcript;
            setRecognizedText(result);
            
            // Проверка: содержит ли сказанное наш символ?
            if (result.includes(currentChar)) {
                setAudioStatus('success');
                setTimeout(() => setStage('writing'), 1000); // Переход к письму
            } else {
                setAudioStatus('fail');
            }
            setIsListening(false);
        };

        recognition.onerror = () => {
            setIsListening(false);
            setAudioStatus('fail');
            setRecognizedText('Error');
        };

        recognition.onend = () => setIsListening(false);
        recognition.start();
    };

    // 3. ОТРИСОВКА (RENDER LOOP)
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !charData) return;
        const ctx = canvas.getContext('2d')!;
        const width = canvas.width;
        const height = canvas.height;

        // Очистка
        ctx.clearRect(0, 0, width, height);

        // Настройка координат (1024x1024 -> Canvas Size)
        ctx.save();
        const scale = width / 1024;
        ctx.scale(scale, -scale); // Y перевернут
        ctx.translate(0, -1024); // Сдвиг вниз

        // A. ФОН: Весь иероглиф (Призрак)
        charData.strokes.forEach((path: string) => {
            ctx.fillStyle = '#333333'; // Темно-серый
            const p = new Path2D(path);
            ctx.fill(p);
        });

        // B. ГОТОВЫЕ ЧЕРТЫ (Черный/Золотой)
        charData.strokes.forEach((path: string, idx: number) => {
            if (idx < strokeIndex) {
                ctx.fillStyle = '#E0E0E0'; // Почти белый (закончено)
                const p = new Path2D(path);
                ctx.fill(p);
            }
        });

        // C. АКТИВНАЯ ЧЕРТА (Подсказка - Красная)
        if (strokeIndex < charData.strokes.length) {
            const activePath = new Path2D(charData.strokes[strokeIndex]);
            ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'; // Полупрозрачный красный
            ctx.fill(activePath);
        }

        ctx.restore();

        // D. ТЕКУЩИЙ СЛЕД ПОЛЬЗОВАТЕЛЯ (Поверх всего, в координатах экрана)
        if (userPath.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#00E5FF'; // Cyan
            ctx.lineWidth = SETTINGS.BRUSH_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            // userPath хранит координаты в 1024 системе (для проверки), 
            // надо конвертировать обратно для рисования или рисовать в трансформированном контексте.
            // Проще рисовать в трансформированном (тот же scale)
            ctx.save();
            ctx.scale(scale, -scale);
            ctx.translate(0, -1024);
            
            ctx.moveTo(userPath[0].x, userPath[0].y);
            for (let i = 1; i < userPath.length; i++) {
                ctx.lineTo(userPath[i].x, userPath[i].y);
            }
            ctx.stroke();
            ctx.restore();
        }

    }, [charData, strokeIndex, userPath]);

    // Анимация кадров
    useEffect(() => {
        let animationFrameId: number;
        const loop = () => {
            renderCanvas();
            animationFrameId = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(animationFrameId);
    }, [renderCanvas]);


    // 4. ОБРАБОТКА ТАЧА / МЫШИ
    const handleStart = (e: any) => {
        e.preventDefault(); // Stop scroll
        if (stage !== 'writing') return;
        isDrawing.current = true;
        const coords = getCoords(e, canvasRef.current!);
        setUserPath([coords]);
    };

    const handleMove = (e: any) => {
        e.preventDefault();
        if (!isDrawing.current) return;
        const coords = getCoords(e, canvasRef.current!);
        setUserPath(prev => [...prev, coords]);
    };

    const handleEnd = () => {
        if (!isDrawing.current) return;
        isDrawing.current = false;

        // ПРОВЕРКА
        if (charData && strokeIndex < charData.strokes.length) {
            const isCorrect = checkStrokeMatch(userPath, charData.strokes[strokeIndex]);
            if (isCorrect) {
                // Успех!
                setStrokeIndex(prev => {
                    const next = prev + 1;
                    if (next >= charData.strokes.length) {
                        setWriteStatus('success');
                        playAudio(); // Финальная награда звуком
                    }
                    return next;
                });
            } else {
                // Ошибка (вибрация)
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }
        setUserPath([]); // Стираем синий след
    };

    // --- NAVIGATION ---
    const nextChar = () => {
        setGlobalIndex(prev => (prev + 1) % CHAR_DATA.length);
    };

    const skip = () => {
        nextChar();
    };

    // === UI ===
    return (
        <div className="flex flex-col h-screen bg-gray-900 text-white font-sans overflow-hidden select-none">
            
            {/* Header */}
            <div className="h-16 bg-gray-800 flex items-center justify-between px-4 shadow-lg z-10">
                <div className="flex items-center gap-3">
                    <span className="text-2xl font-bold text-blue-400 font-serif">{currentChar}</span>
                    <span className="text-gray-400 text-sm">
                        {globalIndex + 1} / {CHAR_DATA.length}
                    </span>
                </div>
                <button onClick={skip} className="text-sm text-gray-400 hover:text-white border border-gray-600 px-3 py-1 rounded">
                    Пропустить >
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-grow flex flex-col items-center justify-center relative">
                
                {/* --- STAGE 1: AUDIO --- */}
                {stage === 'audio' && (
                    <div className="flex flex-col items-center gap-8 animate-fade-in">
                        <div 
                            className="w-48 h-48 bg-gray-800 rounded-full flex items-center justify-center border-4 border-gray-700 cursor-pointer hover:border-blue-500 transition-colors shadow-2xl"
                            onClick={playAudio}
                        >
                            <span className="text-8xl font-serif">{currentChar}</span>
                        </div>
                        
                        <div className="text-center h-12">
                            {audioStatus === 'idle' && <p className="text-gray-400">Нажми микрофон и скажи иероглиф</p>}
                            {audioStatus === 'success' && <p className="text-green-400 font-bold text-xl">Отлично! ✓</p>}
                            {audioStatus === 'fail' && <p className="text-red-400">Не похоже. ({recognizedText})</p>}
                        </div>

                        <button 
                            onClick={startListening}
                            disabled={isListening}
                            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all transform hover:scale-110 ${
                                isListening ? 'bg-red-500 animate-pulse' : 'bg-blue-600 shadow-blue-500/50 shadow-lg'
                            }`}
                        >
                            <span className="text-3xl">🎤</span>
                        </button>
                        
                        <button onClick={() => setStage('writing')} className="text-gray-500 text-sm mt-4 underline">
                            Я не могу говорить (перейти к письму)
                        </button>
                    </div>
                )}

                {/* --- STAGE 2: WRITING --- */}
                {stage === 'writing' && (
                    <div className="relative w-full max-w-sm aspect-square p-4">
                        {/* Status Overlay */}
                        {writeStatus === 'success' && (
                            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-xl animate-fade-in">
                                <div className="text-center">
                                    <div className="text-6xl mb-4">✨</div>
                                    <button 
                                        onClick={nextChar} 
                                        className="bg-green-500 text-white font-bold py-3 px-10 rounded-full text-xl shadow-lg hover:scale-105 transition"
                                    >
                                        Дальше
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="relative w-full h-full bg-gray-800 rounded-2xl shadow-inner border-4 border-gray-700 overflow-hidden">
                            {/* Рисовая сетка (Background) */}
                            <div className="absolute inset-0 opacity-10 pointer-events-none">
                                <svg width="100%" height="100%">
                                    <line x1="0" y1="0" x2="100%" y2="100%" stroke="white" strokeWidth="2" strokeDasharray="10,10"/>
                                    <line x1="100%" y1="0" x2="0" y2="100%" stroke="white" strokeWidth="2" strokeDasharray="10,10"/>
                                    <line x1="50%" y1="0" x2="50%" y2="100%" stroke="white" strokeWidth="2" strokeDasharray="10,10"/>
                                    <line x1="0" y1="50%" x2="100%" y2="50%" stroke="white" strokeWidth="2" strokeDasharray="10,10"/>
                                </svg>
                            </div>

                            <canvas 
                                ref={canvasRef}
                                width={800} height={800} // Internal resolution
                                className="w-full h-full touch-none cursor-crosshair relative z-10"
                                onMouseDown={handleStart} onMouseMove={handleMove} onMouseUp={handleEnd} onMouseLeave={handleEnd}
                                onTouchStart={handleStart} onTouchMove={handleMove} onTouchEnd={handleEnd}
                            />
                        </div>
                        
                        <div className="text-center mt-4 text-gray-400 text-sm">
                            Черта: {strokeIndex + 1} / {charData?.strokes?.length || '?'}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}