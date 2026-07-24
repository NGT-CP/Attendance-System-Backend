import math
import time
import json
import hashlib
import numpy as np
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
from sklearn.cluster import DBSCAN

# ==============================================================================
# CONFIGURATION
# ==============================================================================

@dataclass
class SentryXConfig:
    dbscan_eps_m: float = 15.0
    min_cluster_samples: int = 3
    max_gps_accuracy_m: float = 60.0    # Reject signals worse than this entirely
    cluster_max_accuracy_m: float = 30.0 # Only use highly accurate signals for DBSCAN
    max_signal_age_sec: float = 120.0
    
    # Normalized Confidence Weights
    weights = {
        'cluster': 0.35,
        'device': 0.25,
        'history': 0.20,
        'accuracy': 0.20
    }
    
    # Learning Rate for Classroom Memory (Exponential Moving Average)
    # 0.2 means today's session changes the historical memory by 20%
    memory_learning_rate: float = 0.2 

# ==============================================================================
# UTILITIES & MATH
# ==============================================================================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0)**2
    return R * (2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a)))

def generate_device_hash(raw_metrics: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(raw_metrics, sort_keys=True).encode('utf-8')).hexdigest()

def normalize(value: float, min_val: float, max_val: float) -> float:
    if value <= min_val: return 1.0
    if value >= max_val: return 0.0
    return 1.0 - ((value - min_val) / (max_val - min_val))

# ==============================================================================
# STORAGE REPOSITORY (Data Abstraction Layer)
# ==============================================================================

class StorageRepository:
    """Abstracts database interactions. Easily swappable for Supabase/PostgreSQL later."""
    def __init__(self):
        self._classroom_memory = {
            "CS-301": {"centroid": (26.8625, 75.8160), "radius": 14.2}
        }
        self._device_history = [
            {"student_id": "STU_1", "hash": generate_device_hash({"os": "Windows", "screen": "1920x1080"})},
            {"student_id": "STU_2", "hash": generate_device_hash({"os": "iOS", "screen": "390x844"})} 
        ]
        self._student_trust = {"STU_1": 95.0, "STU_2": 80.0, "STU_3": 40.0}

    def get_classroom_memory(self, class_id: str) -> Optional[Dict[str, Any]]:
        return self._classroom_memory.get(class_id)
        
    def get_device_history(self) -> List[Dict[str, Any]]:
        return self._device_history
        
    def get_student_trust(self, student_id: str) -> float:
        return self._student_trust.get(student_id, 80.0) # Default to 80 if new

    def update_student_trust(self, student_id: str, new_score: float):
        self._student_trust[student_id] = max(0.0, min(100.0, new_score))

    def update_classroom_memory(self, class_id: str, new_centroid: Tuple[float, float], new_radius: float, alpha: float):
        """Gradually updates the room's expected location and size using a moving average."""
        hist = self._classroom_memory.get(class_id)
        if not hist:
            self._classroom_memory[class_id] = {"centroid": new_centroid, "radius": new_radius}
            return
            
        old_lat, old_lng = hist["centroid"]
        updated_lat = (alpha * new_centroid[0]) + ((1.0 - alpha) * old_lat)
        updated_lng = (alpha * new_centroid[1]) + ((1.0 - alpha) * old_lng)
        updated_rad = (alpha * new_radius) + ((1.0 - alpha) * hist["radius"])
        
        self._classroom_memory[class_id] = {"centroid": (updated_lat, updated_lng), "radius": updated_rad}

# ==============================================================================
# SENTRYX INTELLIGENT ANTI-PROXY AI ENGINE (v3.0)
# ==============================================================================

class SentryXAIEngine:
    def __init__(self, config: SentryXConfig, repository: StorageRepository):
        self.config = config
        self.repo = repository

    # --------------------------------------------------------------------------
    # SIGNAL VALIDATION
    # --------------------------------------------------------------------------
    def validate_gps_quality(self, sub: Dict[str, Any], current_time_ms: float) -> Tuple[bool, str]:
        lat, lng, acc = sub.get('lat'), sub.get('lng'), sub.get('accuracy')
        ts = sub.get('timestamp')
        
        if None in (lat, lng, acc, ts): return False, "Missing required GPS fields"
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0): return False, "Invalid coordinate bounds"
        if acc > self.config.max_gps_accuracy_m: return False, f"Accuracy ({acc}m) exceeds hard limit"
        
        time_diff_sec = (current_time_ms - ts) / 1000.0
        if time_diff_sec < -15.0: return False, "Impossible clock timestamp (signal from future)"
        if time_diff_sec > self.config.max_signal_age_sec: return False, "Stale GPS signal (possible replay attack)"
        
        return True, "Valid"

    # --------------------------------------------------------------------------
    # PASS 1: MACRO CLASSROOM AWARENESS
    # --------------------------------------------------------------------------
    def analyze_session_context(self, class_id: str, submissions: List[Dict[str, Any]], current_time_ms: float) -> Dict[str, Any]:
        context = {"is_valid": False, "centroid": None, "live_radius": 15.0, "avg_accuracy": 20.0, "anomaly_flag": False, "reasons": []}
        
        # 1. Pre-validation and Accuracy Filtering
        valid_subs = []
        for s in submissions:
            is_valid, _ = self.validate_gps_quality(s, current_time_ms)
            s['gps_valid'] = is_valid
            # Only use highly accurate points to form the cluster geometry
            if is_valid and s['accuracy'] <= self.config.cluster_max_accuracy_m:
                valid_subs.append(s)

        if len(valid_subs) < self.config.min_cluster_samples:
            context["reasons"].append(f"Insufficient high-quality signals ({len(valid_subs)}) to cluster.")
            return context

        # 2. DBSCAN Clustering
        coords = np.array([[s['lat'], s['lng']] for s in valid_subs])
        db = DBSCAN(eps=self.config.dbscan_eps_m / 6371000.0, min_samples=self.config.min_cluster_samples, metric='haversine').fit(np.radians(coords))
        
        labels = db.labels_
        valid_labels = [l for l in labels if l != -1]
        
        if not valid_labels:
            context["reasons"].append("CRITICAL: No cohesive cluster detected today.")
            return context

        # 3. Extract Largest Cluster & Calculate Weighted Centroid
        largest_cluster_id = max(set(valid_labels), key=valid_labels.count)
        cluster_indices = np.where(labels == largest_cluster_id)[0]
        
        cluster_lats = coords[cluster_indices, 0]
        cluster_lngs = coords[cluster_indices, 1]
        accuracies = np.array([valid_subs[i]['accuracy'] for i in cluster_indices])
        
        weights = 1.0 / np.maximum(accuracies, 1.0)
        centroid_lat = float(np.average(cluster_lats, weights=weights))
        centroid_lng = float(np.average(cluster_lngs, weights=weights))
        context["centroid"] = (centroid_lat, centroid_lng)
        
        # 4. Live Radius & Accuracy
        distances = [haversine_distance(centroid_lat, centroid_lng, lat, lng) for lat, lng in zip(cluster_lats, cluster_lngs)]
        context["live_radius"] = float(np.percentile(distances, 90))
        context["avg_accuracy"] = float(np.median(accuracies))
        context["is_valid"] = True
        context["reasons"].append(f"Live cluster locked. Radius: {context['live_radius']:.1f}m. Anchored by {len(cluster_indices)} devices.")

        # 5. Memory Comparison
        memory = self.repo.get_classroom_memory(class_id)
        if memory:
            drift = haversine_distance(centroid_lat, centroid_lng, memory['centroid'][0], memory['centroid'][1])
            if drift > 100.0:
                context["anomaly_flag"] = True
                context["reasons"].append(f"MACRO ANOMALY: Session drifted {drift:.1f}m from historical location.")
            else:
                context["reasons"].append(f"Historical alignment verified (Drift: {drift:.1f}m).")

        return context

    # --------------------------------------------------------------------------
    # PASS 2: MICRO STUDENT EVALUATION
    # --------------------------------------------------------------------------
    def evaluate_student(self, submission: Dict[str, Any], session_context: Dict[str, Any]) -> Dict[str, Any]:
        student_id = submission['student_id']
        
        # Fast Fail for bad GPS
        if not submission.get('gps_valid', False):
            return {"student_id": student_id, "confidence": 0.0, "status": "REJECTED (HIGH RISK)", "reasons": ["Failed base GPS validation"]}

        reasons = []
        confidences = {}

        # 1. Cluster Confidence
        if session_context["is_valid"]:
            dist_to_center = haversine_distance(submission['lat'], submission['lng'], session_context["centroid"][0], session_context["centroid"][1])
            c_cluster = normalize(dist_to_center, min_val=session_context["live_radius"], max_val=session_context["live_radius"] * 3)
            reasons.append(f"Cluster: {c_cluster:.2f} ({dist_to_center:.1f}m vs live radius {session_context['live_radius']:.1f}m)")
        else:
            c_cluster = 0.5
            reasons.append("Cluster: 0.50 (Macro context unavailable)")
        confidences['cluster'] = c_cluster

        # 2. Hardware Accuracy Confidence
        c_accuracy = normalize(submission['accuracy'], min_val=session_context["avg_accuracy"], max_val=session_context["avg_accuracy"] + 40.0)
        reasons.append(f"Accuracy: {c_accuracy:.2f} ({submission['accuracy']}m vs class avg {session_context['avg_accuracy']:.1f}m)")
        confidences['accuracy'] = c_accuracy

        # 3. Device Trust Confidence
        # TODO: Expand temporal behavior (first seen, frequency, etc.) in future iterations
        device_hash = generate_device_hash(submission['device_metrics'])
        matching_devices = [d for d in self.repo.get_device_history() if d['hash'] == device_hash]
        used_by_others = any(d['student_id'] != student_id for d in matching_devices)
        
        if used_by_others:
            c_device = 0.1
            reasons.append("Device: 0.10 (CRITICAL: Fingerprint shared across accounts)")
        elif any(d['student_id'] == student_id for d in matching_devices):
            c_device = 1.0
            reasons.append("Device: 1.00 (Known trusted hardware)")
        else:
            c_device = 0.85
            reasons.append("Device: 0.85 (New hardware footprint)")
        confidences['device'] = c_device

        # 4. Historical Trust Confidence
        trust_profile = self.repo.get_student_trust(student_id)
        c_history = trust_profile / 100.0
        reasons.append(f"History: {c_history:.2f} (Profile score: {trust_profile:.1f}/100)")
        confidences['history'] = c_history

        # Final Math
        final_confidence = sum(self.config.weights[k] * confidences[k] for k in self.config.weights)
        if session_context.get("anomaly_flag"):
            final_confidence *= 0.7 
            reasons.append("PENALTY: Macro classroom anomaly detected.")

        if final_confidence >= 0.85:
            status = "VERIFIED"
        elif final_confidence >= 0.65:
            status = "FLAGGED (LOW RISK)"
        else:
            status = "REJECTED (HIGH RISK)"

        return {"student_id": student_id, "confidence": round(final_confidence, 3), "status": status, "reasons": reasons}

    # --------------------------------------------------------------------------
    # PASS 3: SYSTEM LEARNING
    # --------------------------------------------------------------------------
    def process_feedback_loops(self, class_id: str, session_context: Dict[str, Any], evaluations: List[Dict[str, Any]]):
        """Updates Classroom Memory and individual Student Trust based on session results."""
        # 1. Update Student Trust
        for eval_res in evaluations:
            sid = eval_res['student_id']
            curr_trust = self.repo.get_student_trust(sid)
            status = eval_res['status']
            
            if status == "VERIFIED": new_trust = curr_trust + 0.5
            elif status == "REJECTED (HIGH RISK)": new_trust = curr_trust - 4.0
            else: new_trust = curr_trust - 0.5
            
            self.repo.update_student_trust(sid, new_trust)

        # 2. Update Classroom Memory (Only if the session was valid and not an anomaly)
        if session_context["is_valid"] and not session_context.get("anomaly_flag"):
            self.repo.update_classroom_memory(
                class_id=class_id,
                new_centroid=session_context["centroid"],
                new_radius=session_context["live_radius"],
                alpha=self.config.memory_learning_rate
            )

# ==============================================================================
# EXECUTION HARNESS
# ==============================================================================

if __name__ == "__main__":
    current_time_ms = time.time() * 1000
    repo = StorageRepository()
    engine = SentryXAIEngine(SentryXConfig(), repo)
    class_id = "CS-301"

    # Simulate Submissions
    submissions = [
        {"student_id": "STU_1", "lat": 26.86251, "lng": 75.81601, "accuracy": 8.0, "timestamp": current_time_ms, "device_metrics": {"os": "Windows", "screen": "1920x1080"}},
        {"student_id": "STU_2", "lat": 26.86255, "lng": 75.81605, "accuracy": 22.0, "timestamp": current_time_ms, "device_metrics": {"os": "iOS", "screen": "390x844"}},
        {"student_id": "STU_3", "lat": 26.87100, "lng": 75.82000, "accuracy": 65.0, "timestamp": current_time_ms, "device_metrics": {"os": "Android", "screen": "1080x2400"}},
        {"student_id": "STU_4", "lat": 26.86249, "lng": 75.81599, "accuracy": 10.0, "timestamp": current_time_ms, "device_metrics": {"os": "Mac", "screen": "2560x1600"}},
        {"student_id": "STU_5", "lat": 26.86252, "lng": 75.81602, "accuracy": 12.0, "timestamp": current_time_ms, "device_metrics": {"os": "Linux", "screen": "1920x1080"}}
    ]

    print("=== PASS 1: MACRO AWARENESS ===")
    session_context = engine.analyze_session_context(class_id, submissions, current_time_ms)
    for r in session_context["reasons"]: print(f"  • {r}")
    print("\n=== PASS 2: MICRO EVALUATION ===")
    
    evaluations = []
    for sub in submissions[:3]:
        res = engine.evaluate_student(sub, session_context)
        evaluations.append(res)
        print(f"[{res['student_id']}] {res['status']} | C: {res['confidence']:.2f}")
        for r in res['reasons']: print(f"    - {r}")
        print()

    print("=== PASS 3: LEARNING LOOPS ===")
    print(f"Memory BEFORE: {repo.get_classroom_memory(class_id)}")
    engine.process_feedback_loops(class_id, session_context, evaluations)
    print(f"Memory AFTER:  {repo.get_classroom_memory(class_id)}")